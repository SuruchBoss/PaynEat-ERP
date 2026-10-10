// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules of a branch requisition (#15; docs/GLOSSARY.md "Requisition", "Par level"; ADR-0009,
 * ADR-0029): how much the screen suggests a branch asks for, what a requisition line must hold,
 * how far transfers have fulfilled it, and when it may still be cancelled. Pure: the service
 * applies them as requisitions are saved and read, and as transfers are created from them.
 *
 * A requisition writes no stock. It is fulfilled by transfers (#14), and only by what they
 * dispatched: a draft transfer is a plan, a reversed one moved nothing.
 *
 * Nothing here is a parameter property or an enum: the console's public demo may import it
 * (ADR-0021).
 */
import {
  add,
  decimalPlaces,
  formatMinimal,
  integerDigits,
  negate,
  parseDecimal,
  sign,
  ZERO,
  type ExactDecimal,
} from '../../../core/quantity/domain/exact-decimal';
import { compareDates } from '../../../core/time/domain/business-date';

/** Stored by the requisition itself; the fulfilment states follow its transfers. */
export type StoredRequisitionStatus = 'draft' | 'submitted' | 'cancelled';
export type RequisitionStatus =
  'draft' | 'submitted' | 'partially_fulfilled' | 'fulfilled' | 'cancelled';

export const NOTE_MAX_LENGTH = 500;
export const REASON_MAX_LENGTH = 500;
/** Quantities are stored as NUMERIC(18,3): digits before the point. */
export const QUANTITY_MAX_INTEGER_DIGITS = 15;

export type QuantityProblem = 'NOT_A_NUMBER' | 'NOT_POSITIVE' | 'TOO_PRECISE' | 'TOO_LARGE';

/** Why `text` is not a quantity above zero in a unit of `decimals` places, or null. */
export function positiveQuantityProblem(text: string, decimals: number): QuantityProblem | null {
  const value = parseDecimal(text);
  if (!value) return 'NOT_A_NUMBER';
  if (sign(value) <= 0) return 'NOT_POSITIVE';
  if (decimalPlaces(value) > decimals) return 'TOO_PRECISE';
  if (integerDigits(value) > QUANTITY_MAX_INTEGER_DIGITS) return 'TOO_LARGE';
  return null;
}

/** As `positiveQuantityProblem`, but zero is allowed (a par level of nothing). */
export function quantityProblem(text: string, decimals: number): QuantityProblem | null {
  const value = parseDecimal(text);
  if (!value) return 'NOT_A_NUMBER';
  if (sign(value) < 0) return 'NOT_POSITIVE';
  if (decimalPlaces(value) > decimals) return 'TOO_PRECISE';
  if (integerDigits(value) > QUANTITY_MAX_INTEGER_DIGITS) return 'TOO_LARGE';
  return null;
}

// --- Suggestion --------------------------------------------------------------------

/**
 * What the requisition screen suggests for one item at one branch (ADR-0009 decision 2):
 * `max(0, par − branch balance − quantity in transit to the branch)`, rounded up to a whole
 * number of the item's requisition unit when it has one. A negative branch balance (a branch
 * may sell what the ledger has not seen arrive, ADR-0003) raises the suggestion: the shortfall is
 * real. Null when the item has no par level at the branch: no suggestion, but it can still be
 * requested.
 */
export function suggestedQuantity(input: {
  par: string | null;
  balance: string;
  inTransit: string;
  /** Base units in one requisition unit (a tray of 12 pieces is "12"); null when none is set. */
  requisitionUnit: string | null;
}): string | null {
  if (input.par === null) return null;
  const short = add(exact(input.par), negate(add(exact(input.balance), exact(input.inTransit))));
  if (sign(short) <= 0) return '0';
  if (input.requisitionUnit === null) return formatMinimal(short);
  return formatMinimal(roundUpToMultiple(short, exact(input.requisitionUnit)));
}

/** The smallest whole multiple of `step` that is at least `value`; both above zero. */
export function roundUpToMultiple(value: ExactDecimal, step: ExactDecimal): ExactDecimal {
  if (sign(step) <= 0) throw new RangeError('A requisition unit is more than zero');
  const scale = Math.max(value.scale, step.scale);
  const v = rescale(value, scale);
  const s = rescale(step, scale);
  const whole = v / s + (v % s === 0n ? 0n : 1n);
  return { units: whole * s, scale };
}

// --- Lines -------------------------------------------------------------------------

/** What a requisition line holds: the item, what was suggested when it was saved, what is asked. */
export interface RequisitionLineInput {
  itemId: string;
  requested: string;
}

export type LineProblem =
  | { code: 'DUPLICATE_ITEM'; itemId: string }
  | { code: 'QUANTITY'; itemId: string; problem: QuantityProblem }
  | { code: 'INACTIVE_ITEM'; itemId: string }
  | { code: 'NOT_A_MULTIPLE'; itemId: string; requisitionUnit: string };

/**
 * The first problem with a requisition's lines, or null: one line per item, an active item, a
 * quantity above zero in the item's unit, and a whole number of its requisition unit when it has
 * one (the plant packs and sends in those).
 */
export function linesProblem(
  lines: readonly RequisitionLineInput[],
  items: ReadonlyMap<string, { decimals: number; active: boolean; requisitionUnit: string | null }>,
): LineProblem | null {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.itemId)) return { code: 'DUPLICATE_ITEM', itemId: line.itemId };
    seen.add(line.itemId);
    const item = items.get(line.itemId);
    if (!item || !item.active) return { code: 'INACTIVE_ITEM', itemId: line.itemId };
    const problem = positiveQuantityProblem(line.requested, item.decimals);
    if (problem) return { code: 'QUANTITY', itemId: line.itemId, problem };
    if (item.requisitionUnit !== null && !isMultiple(line.requested, item.requisitionUnit)) {
      return { code: 'NOT_A_MULTIPLE', itemId: line.itemId, requisitionUnit: item.requisitionUnit };
    }
  }
  return null;
}

/** Whether `quantity` is a whole number of `step`. */
export function isMultiple(quantity: string, step: string): boolean {
  const value = exact(quantity);
  return compare(roundUpToMultiple(value, exact(step)), value) === 0;
}

// --- Fulfilment --------------------------------------------------------------------

/** One requisition line against what its transfers did with the item. */
export interface FulfilmentLine {
  requested: string;
  /** Left in dispatched, not reversed transfers created from the requisition. */
  dispatched: string;
  /** Asked for by its transfers still in draft: planned, not yet sent. */
  drafted: string;
}

/**
 * The requisition's status from its stored one and its lines (#15): a submitted requisition is
 * partially fulfilled once anything was dispatched against it, and fulfilled once every line's
 * dispatched quantity reaches what it requested. Drafted transfers fulfil nothing.
 */
export function requisitionStatus(
  stored: StoredRequisitionStatus,
  lines: readonly FulfilmentLine[],
): RequisitionStatus {
  if (stored !== 'submitted') return stored;
  if (
    lines.length > 0 &&
    lines.every((l) => compare(exact(l.dispatched), exact(l.requested)) >= 0)
  ) {
    return 'fulfilled';
  }
  return lines.some((l) => sign(exact(l.dispatched)) > 0) ? 'partially_fulfilled' : 'submitted';
}

/** What is left to send on a line: requested less dispatched and less what drafts plan, never below zero. */
export function outstanding(line: FulfilmentLine): string {
  const left = add(exact(line.requested), negate(add(exact(line.dispatched), exact(line.drafted))));
  return sign(left) > 0 ? formatMinimal(left) : '0';
}

/** What was requested and not dispatched, ignoring drafts: the shortfall a par-miss counts. */
export function undispatched(line: Pick<FulfilmentLine, 'requested' | 'dispatched'>): string {
  const left = add(exact(line.requested), negate(exact(line.dispatched)));
  return sign(left) > 0 ? formatMinimal(left) : '0';
}

export type RequisitionStep = 'edit' | 'submit' | 'cancel' | 'fulfil';

/**
 * Whether a requisition in `status` may take `step`. A draft is edited and submitted; logistics
 * fulfils a submitted or partially fulfilled one; it is cancelled only before anything was
 * dispatched against it (a draft transfer of it must be cancelled first, which the service checks).
 */
export function stepAllowed(status: RequisitionStatus, step: RequisitionStep): boolean {
  switch (step) {
    case 'edit':
    case 'submit':
      return status === 'draft';
    case 'cancel':
      return status === 'draft' || status === 'submitted';
    case 'fulfil':
      return status === 'submitted' || status === 'partially_fulfilled';
  }
}

/** Why a requisition cannot be submitted as it stands, or null. */
export function submitProblem(input: {
  lineCount: number;
  neededBy: string;
  today: string;
}): 'EMPTY_REQUISITION' | 'NEEDED_BY_PASSED' | null {
  if (input.lineCount === 0) return 'EMPTY_REQUISITION';
  if (compareDates(input.neededBy, input.today) < 0) return 'NEEDED_BY_PASSED';
  return null;
}

// --- Par misses --------------------------------------------------------------------

/**
 * Whether a requisition line missed: by the end of its needed-by date, what was dispatched against
 * it was less than requested (ADR-0009: bad par levels show up). Judged only once that date has
 * passed; a cancelled requisition never misses.
 */
export function lineMissed(input: {
  status: RequisitionStatus;
  neededBy: string;
  today: string;
  requested: string;
  dispatchedByNeededBy: string;
}): boolean {
  if (input.status === 'draft' || input.status === 'cancelled') return false;
  if (compareDates(input.neededBy, input.today) >= 0) return false;
  return compare(exact(input.dispatchedByNeededBy), exact(input.requested)) < 0;
}

function compare(a: ExactDecimal, b: ExactDecimal): number {
  return sign(add(a, negate(b)));
}

function rescale(value: ExactDecimal, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function exact(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new RangeError(`Not a plain decimal: ${text}`);
  return value;
}

/** Zero, for callers that sum lines. */
export const NOTHING = formatMinimal(ZERO);

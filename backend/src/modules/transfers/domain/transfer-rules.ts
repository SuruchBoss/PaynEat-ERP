// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules of a transfer (#14; docs/GLOSSARY.md "Transfer", "Dispatch", "Transfer receipt",
 * "Write-off"; ADR-0007, ADR-0028): which locations stock may move between, what a dispatch must
 * confirm, and how a receipt accounts for every dispatched lot line, as accepted at the
 * destination, returned to the origin or written off, so that nothing stays in transit. Pure: the
 * service applies them as documents are saved, on submission, and again inside the posting
 * transaction. The inspection itself is the shared model in `core/receiving/domain/inspection.ts`,
 * used unchanged.
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
import {
  CONDITIONS,
  temperatureProblem,
  type Finding,
} from '../../../core/receiving/domain/inspection';
import { isExpired } from '../../../core/stock/domain/fefo';
import { compareDates } from '../../../core/time/domain/business-date';

/** A transfer as people see it: its stock document's status, and whether its receipt posted. */
export type TransferStatus = 'draft' | 'dispatched' | 'received' | 'reversed' | 'cancelled';
export type ReceiptStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected';

export const NOTE_MAX_LENGTH = 500;
export const REASON_MAX_LENGTH = 500;
/** Quantities are stored as NUMERIC(18,3): digits before the point. */
export const QUANTITY_MAX_INTEGER_DIGITS = 15;
/** A piece count is a whole number, stored as NUMERIC(18,0). */
export const PIECES_MAX_DIGITS = 15;

type LocationKind = 'plant' | 'warehouse' | 'branch' | 'in_transit' | 'subcontractor';

/** Where stock may leave from and go to (#14, ADR-0007): out of a plant or warehouse, into a branch or warehouse. */
export const ORIGIN_TYPES: readonly LocationKind[] = ['plant', 'warehouse'];
export const DESTINATION_TYPES: readonly LocationKind[] = ['branch', 'warehouse'];

export type RouteProblem =
  | 'ORIGIN_NOT_PLANT_OR_WAREHOUSE'
  | 'DESTINATION_NOT_BRANCH_OR_WAREHOUSE'
  | 'SAME_LOCATION'
  | 'ORIGIN_INACTIVE'
  | 'DESTINATION_INACTIVE';

/** What is wrong with sending stock from `origin` to `destination`, or null. */
export function routeProblem(
  origin: { id: string; type: LocationKind; active: boolean },
  destination: { id: string; type: LocationKind; active: boolean },
): RouteProblem | null {
  if (!ORIGIN_TYPES.includes(origin.type)) return 'ORIGIN_NOT_PLANT_OR_WAREHOUSE';
  if (!DESTINATION_TYPES.includes(destination.type)) return 'DESTINATION_NOT_BRANCH_OR_WAREHOUSE';
  if (origin.id === destination.id) return 'SAME_LOCATION';
  if (!origin.active) return 'ORIGIN_INACTIVE';
  if (!destination.active) return 'DESTINATION_INACTIVE';
  return null;
}

export type QuantityProblem = 'NOT_A_NUMBER' | 'NOT_POSITIVE' | 'TOO_PRECISE' | 'TOO_LARGE';

/** What is wrong with a quantity that must be more than zero in a unit of `decimals`, or null. */
export function positiveQuantityProblem(text: string, decimals: number): QuantityProblem | null {
  const value = parseDecimal(text);
  if (!value) return 'NOT_A_NUMBER';
  if (sign(value) <= 0) return 'NOT_POSITIVE';
  if (decimalPlaces(value) > decimals) return 'TOO_PRECISE';
  if (integerDigits(value) > QUANTITY_MAX_INTEGER_DIGITS) return 'TOO_LARGE';
  return null;
}

/** As `positiveQuantityProblem`, but zero is allowed. */
export function quantityProblem(text: string, decimals: number): QuantityProblem | null {
  const value = parseDecimal(text);
  if (!value) return 'NOT_A_NUMBER';
  if (sign(value) < 0) return 'NOT_POSITIVE';
  if (decimalPlaces(value) > decimals) return 'TOO_PRECISE';
  if (integerDigits(value) > QUANTITY_MAX_INTEGER_DIGITS) return 'TOO_LARGE';
  return null;
}

/** Whether `text` is a whole piece count not below zero (above zero when `positive`). */
export function piecesValid(text: string, positive: boolean): boolean {
  const value = parseDecimal(text);
  if (!value || decimalPlaces(value) > 0 || integerDigits(value) > PIECES_MAX_DIGITS) return false;
  return positive ? sign(value) > 0 : sign(value) >= 0;
}

// --- Dispatch ----------------------------------------------------------------------

/** One lot a dispatch takes, as the person confirming it left. */
export interface DispatchPick {
  lineNo: number;
  lotId: string;
  quantity: string;
  pieces: string | null;
}

export type DispatchBlocker =
  | { rule: 'empty_document' }
  | { rule: 'inactive_location' }
  | { rule: 'inactive_item'; lineNo: number }
  | { rule: 'nothing_picked'; lineNo: number }
  | { rule: 'expired_lot'; lineNo: number; lotId: string }
  | { rule: 'pieces_required'; lineNo: number; lotId: string };

/**
 * Everything that would refuse a dispatch as it stands, in order: the first is the rule the
 * posting is refused by. Every line has at least one lot (a line the origin cannot fill is taken
 * off the draft, not dispatched empty); no lot has expired on the dispatch's business date
 * (ADR-0006); and a variable-weight lot leaves with its piece count, so the branch can count the
 * birds against it (ADR-0005). Whether the origin still holds enough is the ledger's to decide,
 * under its locks (ADR-0003).
 */
export function dispatchBlockers(input: {
  businessDate: string;
  locationsActive: boolean;
  lines: ReadonlyArray<{ lineNo: number; item: { active: boolean; variableWeight: boolean } }>;
  picks: readonly DispatchPick[];
  lots: ReadonlyMap<string, { expiryDate: string }>;
}): DispatchBlocker[] {
  const blockers: DispatchBlocker[] = [];
  if (input.lines.length === 0) return [{ rule: 'empty_document' }];
  if (!input.locationsActive) blockers.push({ rule: 'inactive_location' });
  for (const line of input.lines) {
    const lineNo = line.lineNo;
    if (!line.item.active) blockers.push({ rule: 'inactive_item', lineNo });
    const picks = input.picks.filter((p) => p.lineNo === lineNo);
    if (picks.length === 0) blockers.push({ rule: 'nothing_picked', lineNo });
    for (const pick of picks) {
      const lot = input.lots.get(pick.lotId);
      if (lot && isExpired(lot.expiryDate, input.businessDate)) {
        blockers.push({ rule: 'expired_lot', lineNo, lotId: pick.lotId });
      }
      if (line.item.variableWeight && pick.pieces === null) {
        blockers.push({ rule: 'pieces_required', lineNo, lotId: pick.lotId });
      }
    }
  }
  return blockers;
}

/** The sum of quantities, in their shortest exact spelling. */
export function total(quantities: readonly string[]): string {
  return formatMinimal(quantities.reduce((sum, q) => add(sum, exact(q)), ZERO));
}

/** What the picks of a line leave unfilled of what was asked for, never below zero. */
export function shortBy(requested: string, picked: readonly string[]): string {
  const rest = add(exact(requested), negate(exact(total(picked))));
  return formatMinimal(sign(rest) < 0 ? ZERO : rest);
}

// --- Receipt -----------------------------------------------------------------------

/**
 * One dispatched lot line as the branch records it. Quantities are in the item's base unit (a
 * transfer moves base units); pieces are recorded for variable-weight items only.
 *
 * - `received` is what arrived, weighed or counted: the inspection compares it with what was
 *   dispatched.
 * - `accepted` goes into the destination's stock; `returned` goes back to the origin; `writtenOff`
 *   leaves stock. Together they account for exactly what was dispatched (ADR-0007 decision 4).
 */
export interface ReceiptLineInput {
  received: string;
  receivedPieces: string | null;
  temperature: string | null;
  condition: string;
  accepted: string;
  acceptedPieces: string | null;
  returned: string;
  returnedPieces: string | null;
  writtenOff: string;
  writtenOffPieces: string | null;
  reason: string | null;
}

export type ReceiptLineProblem =
  | 'RECEIVED_INVALID'
  | 'ACCEPTED_INVALID'
  | 'RETURNED_INVALID'
  | 'WRITTEN_OFF_INVALID'
  | 'ACCEPTED_MORE_THAN_RECEIVED'
  | 'RETURNED_MORE_THAN_TURNED_AWAY'
  | 'PIECES_REQUIRED'
  | 'PIECES_NOT_ALLOWED'
  | 'PIECES_INVALID'
  | 'PIECES_WITHOUT_QUANTITY'
  | 'ACCEPTED_WITHOUT_PIECES'
  | 'TEMPERATURE_NOT_A_NUMBER'
  | 'TEMPERATURE_OUT_OF_RANGE'
  | 'TEMPERATURE_TOO_PRECISE'
  | 'CONDITION_UNKNOWN'
  | 'REASON_TOO_LONG';

/**
 * What is wrong with one line on its own, or null. Every quantity is zero or more, no more precise
 * than the item's base unit allows (refused, not rounded: ADR-0019). Only what arrived can be
 * accepted, and only what arrived and was turned away can go back on the truck: what never
 * arrived cannot be returned, it is written off. A variable-weight item records pieces for each
 * part; pieces never exist without weight, and accepted stock always has pieces. Weight written
 * off without pieces is allowed: chicken loses weight on the road, birds do not vanish.
 */
export function receiptLineProblem(
  line: ReceiptLineInput,
  item: { decimals: number; variableWeight: boolean },
): ReceiptLineProblem | null {
  if (quantityProblem(line.received, item.decimals)) return 'RECEIVED_INVALID';
  if (quantityProblem(line.accepted, item.decimals)) return 'ACCEPTED_INVALID';
  if (quantityProblem(line.returned, item.decimals)) return 'RETURNED_INVALID';
  if (quantityProblem(line.writtenOff, item.decimals)) return 'WRITTEN_OFF_INVALID';
  const received = exact(line.received);
  const accepted = exact(line.accepted);
  if (compare(accepted, received) > 0) return 'ACCEPTED_MORE_THAN_RECEIVED';
  if (compare(exact(line.returned), add(received, negate(accepted))) > 0) {
    return 'RETURNED_MORE_THAN_TURNED_AWAY';
  }

  const parts: Array<[string, string | null]> = [
    [line.received, line.receivedPieces],
    [line.accepted, line.acceptedPieces],
    [line.returned, line.returnedPieces],
    [line.writtenOff, line.writtenOffPieces],
  ];
  if (item.variableWeight) {
    if (parts.some(([, pieces]) => pieces === null)) return 'PIECES_REQUIRED';
    if (parts.some(([, pieces]) => !piecesValid(pieces!, false))) return 'PIECES_INVALID';
    if (
      parts.some(([quantity, pieces]) => sign(exact(pieces!)) > 0 && sign(exact(quantity)) === 0)
    ) {
      return 'PIECES_WITHOUT_QUANTITY';
    }
    if (sign(accepted) > 0 && sign(exact(line.acceptedPieces!)) === 0) {
      return 'ACCEPTED_WITHOUT_PIECES';
    }
  } else if (parts.some(([, pieces]) => pieces !== null)) {
    return 'PIECES_NOT_ALLOWED';
  }

  if (line.temperature !== null) {
    const problem = temperatureProblem(line.temperature);
    if (problem) return problem;
  }
  if (!(CONDITIONS as readonly string[]).includes(line.condition)) return 'CONDITION_UNKNOWN';
  if (line.reason !== null && line.reason.trim().length > REASON_MAX_LENGTH) {
    return 'REASON_TOO_LONG';
  }
  return null;
}

/**
 * Whether accepted, returned and written off account for exactly what was dispatched, pieces
 * included: anything less would stay in transit, anything more would take in-transit below zero.
 */
export function differenceResolved(
  dispatched: { quantity: string; pieces: string | null },
  line: Pick<
    ReceiptLineInput,
    | 'accepted'
    | 'acceptedPieces'
    | 'returned'
    | 'returnedPieces'
    | 'writtenOff'
    | 'writtenOffPieces'
  >,
): boolean {
  const accounted = add(add(exact(line.accepted), exact(line.returned)), exact(line.writtenOff));
  if (compare(accounted, exact(dispatched.quantity)) !== 0) return false;
  if (dispatched.pieces === null) return true;
  const pieces = [line.acceptedPieces, line.returnedPieces, line.writtenOffPieces];
  if (pieces.some((p) => p === null)) return false;
  const accountedPieces = pieces.reduce<ExactDecimal>((sum, p) => add(sum, exact(p!)), ZERO);
  return compare(accountedPieces, exact(dispatched.pieces)) === 0;
}

/**
 * The part of what was dispatched still unaccounted for, never below zero: what the console
 * shows as "still to resolve" while the line is being filled in.
 */
export function unresolved(
  dispatched: string,
  line: Pick<ReceiptLineInput, 'accepted' | 'returned' | 'writtenOff'>,
): string {
  const rest = add(
    exact(dispatched),
    negate(add(add(exact(line.accepted), exact(line.returned)), exact(line.writtenOff))),
  );
  return formatMinimal(rest);
}

/**
 * A line needs a reason when the inspection found anything outside tolerance, or when any of it
 * does not go into the destination's stock: a return and a write-off always say why (ADR-0007
 * decision 4).
 */
export function reasonRequired(
  findings: readonly Finding[],
  line: Pick<ReceiptLineInput, 'returned' | 'writtenOff'>,
): boolean {
  return findings.length > 0 || sign(exact(line.returned)) > 0 || sign(exact(line.writtenOff)) > 0;
}

/**
 * Whether a receipt needs someone else's approval before it posts: an inspection finding on any
 * line (ADR-0007 decision 2), or any quantity written off, since a write-off removes stock and
 * always has an approver (docs/GLOSSARY.md "Write-off"). Returning goods to the origin moves
 * them, it loses nothing, and needs no approval of its own.
 */
export function needsApproval(
  lines: ReadonlyArray<{ findings: readonly Finding[]; writtenOff: string }>,
): boolean {
  return lines.some((line) => line.findings.length > 0 || sign(exact(line.writtenOff)) > 0);
}

export type ReceiptRefusal =
  | { rule: 'transfer_not_dispatched' }
  | { rule: 'already_received' }
  | { rule: 'transfer_reversed' }
  | { rule: 'business_date_before_dispatch' }
  | { rule: 'inactive_location' }
  | { rule: 'temperature_required'; lineNo: number }
  | { rule: 'difference_unresolved'; lineNo: number }
  | { rule: 'reason_required'; lineNo: number }
  | { rule: 'expired_on_arrival'; lineNo: number };

export interface CheckedReceiptLine {
  lineNo: number;
  temperatureRequired: boolean;
  findings: readonly Finding[];
  resolved: boolean;
  accepted: string;
  returned: string;
  writtenOff: string;
  reason: string | null;
  /** The lot's own expiry: a transfer never changes it (ADR-0014). */
  expiryDate: string;
}

/**
 * The first reason this receipt cannot go forward, or null. Checked as the receipt is shown, on
 * submission, and again when posting with the transfer locked, because another receipt of the
 * same transfer may have posted first. A lot that has expired by the day it arrives is never
 * accepted into the branch (ADR-0006): it goes back or is written off. A deactivated destination
 * still lets everything go back or be written off, so stock is never trapped in transit.
 */
export function receiptRefusal(receipt: {
  businessDate: string;
  transferStatus: TransferStatus;
  dispatchDate: string;
  destinationActive: boolean;
  lines: readonly CheckedReceiptLine[];
}): ReceiptRefusal | null {
  if (receipt.transferStatus === 'received') return { rule: 'already_received' };
  if (receipt.transferStatus === 'reversed') return { rule: 'transfer_reversed' };
  if (receipt.transferStatus !== 'dispatched') return { rule: 'transfer_not_dispatched' };
  if (compareDates(receipt.businessDate, receipt.dispatchDate) < 0) {
    return { rule: 'business_date_before_dispatch' };
  }
  const accepting = receipt.lines.some((line) => sign(exact(line.accepted)) > 0);
  if (accepting && !receipt.destinationActive) return { rule: 'inactive_location' };
  for (const line of receipt.lines) {
    const lineNo = line.lineNo;
    if (line.temperatureRequired) return { rule: 'temperature_required', lineNo };
    if (!line.resolved) return { rule: 'difference_unresolved', lineNo };
    if (
      reasonRequired(line.findings, line) &&
      (line.reason === null || line.reason.trim().length === 0)
    ) {
      return { rule: 'reason_required', lineNo };
    }
    if (sign(exact(line.accepted)) > 0 && isExpired(line.expiryDate, receipt.businessDate)) {
      return { rule: 'expired_on_arrival', lineNo };
    }
  }
  return null;
}

export type ReceiptStep = 'edit' | 'submit' | 'approve' | 'reject' | 'post';

const STEP_FROM: Record<ReceiptStep, readonly ReceiptStatus[]> = {
  edit: ['draft'],
  submit: ['draft'],
  approve: ['submitted'],
  // A submitted receipt, or an approved one the ledger refused to post.
  reject: ['submitted', 'approved'],
  post: ['approved'],
};

export function receiptStepAllowed(status: ReceiptStatus, step: ReceiptStep): boolean {
  return STEP_FROM[step].includes(status);
}

/**
 * The transfer's status from its stock document's, its receipt's and its reversal's: a posted
 * dispatch is dispatched until a receipt of it posts (received) or logistics reverses it while no
 * receipt has (reversed). The two exclude each other (ADR-0028).
 */
export function transferStatus(
  documentStatus: 'draft' | 'posted' | 'cancelled',
  receiptPosted: boolean,
  reversed = false,
): TransferStatus {
  if (documentStatus === 'draft') return 'draft';
  if (documentStatus === 'cancelled') return 'cancelled';
  if (reversed) return 'reversed';
  return receiptPosted ? 'received' : 'dispatched';
}

/**
 * Why a dispatch cannot be reversed as the transfer stands, or null: only a dispatched transfer
 * is, never one a receipt has taken out of transit (that is corrected by an adjustment). The
 * ledger refuses a draft, a cancelled one and a second reversal on its own.
 */
export function dispatchReversalRefusal(status: TransferStatus): 'already_received' | null {
  return status === 'received' ? 'already_received' : null;
}

function compare(a: ExactDecimal, b: ExactDecimal): number {
  return sign(add(a, negate(b)));
}

function exact(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new RangeError(`Not a plain decimal: ${text}`);
  return value;
}

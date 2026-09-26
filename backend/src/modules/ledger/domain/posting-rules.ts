// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The ledger's rules as pure functions (ADR-0003, ADR-0004, ADR-0018): what a posting does to
 * balances, when it is refused, and what a reversal writes. The ledger service runs them
 * between locking the balance rows and writing, inside the posting's transaction.
 */
import {
  add,
  formatMinimal,
  negate,
  parseDecimal,
  sign,
  type ExactDecimal,
} from '../../../core/quantity/domain/exact-decimal';
import { compareDates } from '../../../core/time/domain/business-date';

/**
 * Why a posting or reversal was refused: the `rule` label of `ledger.posting.refused` and
 * `erp_postings_total` (docs/TELEMETRY.md). Snake case, stable, never translated.
 */
export type PostingRule =
  | 'already_posted'
  | 'stale_revision'
  | 'empty_document'
  | 'business_date_in_future'
  | 'inactive_location'
  | 'inactive_item'
  | 'secondary_quantity_not_allowed'
  | 'expired_lot'
  | `negative_stock_${Exclude<LocationType, 'branch'>}`
  | 'not_posted'
  | 'reversal_of_reversal'
  | 'already_reversed'
  | 'business_date_before_original';

/** Refusals that describe a race with another person rather than a wrong document: 409. */
export const CONFLICT_RULES: ReadonlySet<PostingRule> = new Set([
  'already_posted',
  'stale_revision',
  'already_reversed',
]);

export type LocationType = 'plant' | 'warehouse' | 'branch' | 'in_transit' | 'subcontractor';

/** One change to one lot at one location. Quantities are decimal strings (ADR-0019). */
export interface Movement {
  /** The document line it comes from. */
  lineNo: number;
  lotId: string;
  itemId: string;
  locationId: string;
  /** Signed, in the item's base unit, never zero. */
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  /** Reversals only: the entry this movement negates. */
  reversesEntryId?: string;
}

export interface Balance {
  lotId: string;
  itemId: string;
  locationId: string;
  quantity: string;
  secondaryQuantity: string | null;
}

export type BalanceKey = `${string}|${string}`;
export const balanceKey = (lotId: string, locationId: string): BalanceKey =>
  `${lotId}|${locationId}`;

/**
 * The order balance rows are locked in: by lot, then location. Every posting takes its locks
 * in this one order, so two postings touching the same lots wait for each other instead of
 * deadlocking (ADR-0003, decision 6).
 */
export function lockOrder<T extends { lotId: string; locationId: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.lotId === b.lotId
      ? a.locationId < b.locationId
        ? -1
        : a.locationId > b.locationId
          ? 1
          : 0
      : a.lotId < b.lotId
        ? -1
        : 1,
  );
}

/** The net change a document makes to each balance it touches, in lock order. */
export function netChanges(movements: Movement[]): Balance[] {
  const byKey = new Map<BalanceKey, Balance>();
  for (const m of movements) {
    const key = balanceKey(m.lotId, m.locationId);
    const current = byKey.get(key);
    byKey.set(key, {
      lotId: m.lotId,
      itemId: m.itemId,
      locationId: m.locationId,
      quantity: sum(current?.quantity ?? '0', m.quantity),
      secondaryQuantity: sumSecondary(current?.secondaryQuantity ?? null, m.secondaryQuantity),
    });
  }
  return lockOrder([...byKey.values()]);
}

export type ApplyResult =
  | { ok: true; balances: Balance[]; negativeAtBranch: Balance[] }
  | { ok: false; rule: PostingRule; lotId: string; locationId: string; quantity: string };

/**
 * The balances after a document's movements, or the rule that refuses it. Plant, warehouse
 * and in-transit stock never goes negative, because every movement there is backed by a
 * document and a negative balance can only mean an error. A branch may go negative, because
 * its consumption follows sales that already happened; those balances are returned flagged
 * (ADR-0003, decision 5). The document is judged by its net effect on each lot.
 */
export function applyMovements(
  current: Balance[],
  movements: Movement[],
  locationTypes: ReadonlyMap<string, LocationType>,
): ApplyResult {
  const existing = new Map(current.map((b) => [balanceKey(b.lotId, b.locationId), b]));
  const balances: Balance[] = [];
  const negativeAtBranch: Balance[] = [];

  for (const change of netChanges(movements)) {
    const before = existing.get(balanceKey(change.lotId, change.locationId));
    const after: Balance = {
      ...change,
      quantity: sum(before?.quantity ?? '0', change.quantity),
      secondaryQuantity: sumSecondary(before?.secondaryQuantity ?? null, change.secondaryQuantity),
    };
    const type = locationTypes.get(change.locationId);
    if (type === undefined) {
      throw new Error(`no location type for ${change.locationId}`);
    }
    if (sign(decimal(after.quantity)) < 0) {
      if (type === 'branch') {
        negativeAtBranch.push(after);
      } else {
        return {
          ok: false,
          rule: `negative_stock_${type}`,
          lotId: change.lotId,
          locationId: change.locationId,
          quantity: after.quantity,
        };
      }
    }
    balances.push(after);
  }
  return { ok: true, balances, negativeAtBranch };
}

export interface PostedEntry {
  id: string;
  lineNo: number;
  lotId: string;
  itemId: string;
  locationId: string;
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
}

/**
 * What a reversal writes: every entry of the original, negated exactly — same lot, location
 * and cost, opposite quantity and secondary quantity — each pointing at the entry it negates.
 */
export function reversalMovements(entries: PostedEntry[]): Movement[] {
  return entries.map((entry) => ({
    lineNo: entry.lineNo,
    lotId: entry.lotId,
    itemId: entry.itemId,
    locationId: entry.locationId,
    quantity: formatMinimal(negate(decimal(entry.quantity))),
    secondaryQuantity:
      entry.secondaryQuantity === null
        ? null
        : formatMinimal(negate(decimal(entry.secondaryQuantity))),
    unitCost: entry.unitCost,
    reversesEntryId: entry.id,
  }));
}

/** A business date is never later than today in the company's time zone (ADR-0018). */
export function businessDateProblem(businessDate: string, today: string): PostingRule | null {
  return compareDates(businessDate, today) > 0 ? 'business_date_in_future' : null;
}

export interface ReversibleDocument {
  type: 'opening_balance' | 'reversal';
  status: 'draft' | 'posted';
  businessDate: string;
  reversedBy: string | null;
}

/**
 * Whether a document can be reversed on `businessDate`. Only a posted document, only once,
 * never a reversal itself (a wrong reversal is corrected by posting the right document again),
 * and on a date between the original's business date and today: the lots the original created
 * did not exist before it, so a reversal dated earlier would show them below zero in the past.
 */
export function reversalProblem(
  original: ReversibleDocument,
  businessDate: string,
  today: string,
): PostingRule | null {
  if (original.status !== 'posted') return 'not_posted';
  if (original.type === 'reversal') return 'reversal_of_reversal';
  if (original.reversedBy !== null) return 'already_reversed';
  if (compareDates(businessDate, today) > 0) return 'business_date_in_future';
  if (compareDates(businessDate, original.businessDate) < 0) return 'business_date_before_original';
  return null;
}

/** A lot's number: its origin document's number and line, OB-2026-00001/2. */
export function lotNumber(documentNumber: string, lineNo: number): string {
  return `${documentNumber}/${lineNo}`;
}

function sum(a: string, b: string): string {
  return formatMinimal(add(decimal(a), decimal(b)));
}

/** Like SQL's SUM: nulls are skipped, and all nulls give null. */
function sumSecondary(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return sum(a, b);
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}

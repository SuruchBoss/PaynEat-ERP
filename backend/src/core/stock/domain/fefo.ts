// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * First expired, first out (ADR-0004, ADR-0006): which lots a quantity is taken from. Production
 * inputs pick with it (#13); transfers and branch consumption reuse it. Lots with nothing left
 * are skipped, and lots past their expiry on the movement's business date are never picked: an
 * expired lot is only written off (ADR-0006). The order is the lot's expiry, then its number, so
 * the same stock always gives the same picks.
 */
import { compareDates } from '../../time/domain/business-date';
import {
  add,
  formatMinimal,
  negate,
  parseDecimal,
  sign,
  ZERO,
  type ExactDecimal,
} from '../../quantity/domain/exact-decimal';

export interface FefoLot {
  lotId: string;
  /** The lot's number, OB-2026-00001/2: the tie-break after expiry. */
  number: string;
  /** ISO `YYYY-MM-DD`. */
  expiryDate: string;
  /** What is left at the location, in the item's base unit. */
  available: string;
}

export interface FefoPick {
  lotId: string;
  number: string;
  expiryDate: string;
  quantity: string;
}

export interface FefoResult {
  picks: FefoPick[];
  /** What the usable lots could not cover; "0" when they cover it all. */
  shortBy: string;
}

/** A lot past its expiry on the business date: it cannot be issued, consumed or moved. */
export function isExpired(expiryDate: string, businessDate: string): boolean {
  return compareDates(expiryDate, businessDate) < 0;
}

/** The order FEFO takes lots in: earliest expiry, then lot number, documents and lines by value. */
export function fefoOrder<T extends { expiryDate: string; number: string }>(
  lots: readonly T[],
): T[] {
  return [...lots].sort(
    (a, b) => compareDates(a.expiryDate, b.expiryDate) || compareLotNumbers(a.number, b.number),
  );
}

/**
 * The lots `quantity` is taken from on `businessDate`, earliest expiry first. Expired lots and
 * lots with nothing left are skipped. When the usable lots hold less than asked, every one is
 * taken and the rest is reported as `shortBy`: the caller decides whether that refuses the
 * movement (plant stock never goes negative) or not (branch consumption, ADR-0003).
 */
export function fefoPick(
  lots: readonly FefoLot[],
  quantity: string,
  businessDate: string,
): FefoResult {
  let remaining = decimal(quantity);
  if (sign(remaining) < 0) throw new RangeError('A quantity to pick is never below zero');
  const picks: FefoPick[] = [];
  for (const lot of fefoOrder(lots)) {
    if (sign(remaining) === 0) break;
    if (isExpired(lot.expiryDate, businessDate)) continue;
    const available = decimal(lot.available);
    if (sign(available) <= 0) continue;
    const take = compare(available, remaining) < 0 ? available : remaining;
    picks.push({
      lotId: lot.lotId,
      number: lot.number,
      expiryDate: lot.expiryDate,
      quantity: formatMinimal(take),
    });
    remaining = add(remaining, negate(take));
  }
  return { picks, shortBy: formatMinimal(remaining) };
}

/**
 * Lot numbers compare by document, then by line as a number, so OB-2026-00001/10 comes after
 * OB-2026-00001/9. Document numbers are zero padded, so they compare as text.
 */
export function compareLotNumbers(a: string, b: string): number {
  const [docA, lineA = ''] = a.split('/');
  const [docB, lineB = ''] = b.split('/');
  if (docA !== docB) return docA < docB ? -1 : 1;
  const numA = Number(lineA);
  const numB = Number(lineB);
  if (Number.isInteger(numA) && Number.isInteger(numB) && numA !== numB) return numA - numB;
  return lineA < lineB ? -1 : lineA > lineB ? 1 : 0;
}

function compare(a: ExactDecimal, b: ExactDecimal): number {
  return sign(add(a, negate(b)));
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}

/** Zero, for callers that sum picks. */
export const NOTHING = formatMinimal(ZERO);

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Branch consumption (#17, ADR-0002, ADR-0003, ADR-0004, ADR-0006, ADR-0030): which of a branch's
 * lots a sale's ingredients come out of. A sale is never refused because of stock. FEFO takes
 * what the branch's usable lots hold; anything they cannot cover is taken from the lot of that
 * item the branch received most recently, even when it is used up or past its expiry, so the
 * shortfall shows as that lot going below zero. A branch that has never held the item has no such
 * lot: the shortfall goes to the item's placeholder lot at the branch. No clock here.
 */
import { fefoPick, isExpired, type FefoLot } from '../../../core/stock/domain/fefo';
import {
  add,
  formatMinimal,
  parseDecimal,
  roundHalfAwayFromZero,
  sign,
  type ExactDecimal,
} from '../../../core/quantity/domain/exact-decimal';

/** The lot of the item the branch received most recently, whatever is left of it. */
export interface LastReceivedLot {
  lotId: string;
  number: string;
  expiryDate: string;
}

export interface BranchPick {
  lotId: string;
  number: string;
  /** In the item's base unit, above zero. */
  quantity: string;
  /** Taken beyond what the branch's usable lots held: the lot goes below zero by it. */
  shortfall: boolean;
  /** The lot was past its expiry on the sale's business date (shortfall picks only). */
  expired: boolean;
}

export interface BranchAllocation {
  picks: BranchPick[];
  /**
   * What neither the branch's lots nor a lot it received could take, because it never held the
   * item: it goes to the item's placeholder lot at the branch (ADR-0030). "0" otherwise.
   */
  toPlaceholder: string;
}

/**
 * Where `quantity` of one item comes from at a branch on `businessDate`: FEFO over the usable
 * lots first; the rest from the most recently received lot, or else the placeholder.
 */
export function allocateAtBranch(
  lots: readonly FefoLot[],
  quantity: string,
  businessDate: string,
  lastReceived: LastReceivedLot | null,
): BranchAllocation {
  const { picks, shortBy } = fefoPick(lots, quantity, businessDate);
  const result: BranchPick[] = picks.map((pick) => ({
    lotId: pick.lotId,
    number: pick.number,
    quantity: pick.quantity,
    shortfall: false,
    expired: false,
  }));
  if (sign(decimal(shortBy)) === 0) return { picks: result, toPlaceholder: '0' };
  if (!lastReceived) return { picks: result, toPlaceholder: shortBy };

  const expired = isExpired(lastReceived.expiryDate, businessDate);
  const already = result.find((pick) => pick.lotId === lastReceived.lotId);
  if (already) {
    already.quantity = formatMinimal(add(decimal(already.quantity), decimal(shortBy)));
    already.shortfall = true;
    already.expired = expired;
  } else {
    result.push({
      lotId: lastReceived.lotId,
      number: lastReceived.number,
      quantity: shortBy,
      shortfall: true,
      expired,
    });
  }
  return { picks: result, toPlaceholder: '0' };
}

/**
 * A sale's usage of one item as the ledger keeps it: rounded once, half away from zero, to the
 * item's base-unit decimals (ADR-0019, decision 4). Null when it rounds to nothing, so a trace of
 * an ingredient writes no entry.
 */
export function consumedQuantity(usage: string, baseUnitDecimals: number): string | null {
  const rounded = roundHalfAwayFromZero(decimal(usage), baseUnitDecimals);
  return sign(rounded) > 0 ? formatMinimal(rounded) : null;
}

/**
 * What happens to a received sale now (ADR-0030):
 * - `process`: its business date has come; turn it into consumption.
 * - `wait`: it is dated after today but within the tolerance of when the ERP received it (a sale
 *   just before midnight on a clock a little fast); it is left untouched until its day comes.
 * - `hold`: it is further ahead of its receipt than the tolerance, which usually means a tablet
 *   with a wrong clock. It is not posted into a distant period: it stays received, held and
 *   flagged `sale_time_ahead` where people see it, until a person re-processes it once its date
 *   has come. It has not failed, and its time is never corrected.
 */
export type SaleTimeDecision = 'process' | 'wait' | 'hold';

/**
 * `toleranceSeconds` is configuration (ADR-0007), never a constant here. `reviewed` is true when
 * a person re-processes the event: the hold has been looked at, and the sale then only waits for
 * its day, like any other.
 */
export function saleTimeDecision(input: {
  saleTime: Date;
  receivedAt: Date;
  saleDate: string;
  today: string;
  toleranceSeconds: number;
  reviewed: boolean;
}): SaleTimeDecision {
  const aheadMs = input.saleTime.getTime() - input.receivedAt.getTime();
  if (!input.reviewed && aheadMs > input.toleranceSeconds * 1000) return 'hold';
  return input.saleDate > input.today ? 'wait' : 'process';
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}

/**
 * Why a failed or held sales event cannot be re-processed now, or null when it can (ADR-0030):
 * - master data a person can fix (an unknown menu item or modifier, an ingredient no longer in
 *   use) is always worth another try;
 * - a sale held for its time waits until its date has come;
 * - a recipe never starts in the past, so a sale with no recipe in force can be rescued only on
 *   its own day; an older one stays failed (#76);
 * - how it was sold, and recipes that disagree, cannot be fixed for a sale that happened.
 */
export function reprocessBlock(
  reason: string,
  saleDate: string,
  today: string,
): 'sale_date_not_yet' | 'past_sale_without_recipe' | 'not_fixable' | null {
  switch (reason) {
    case 'unknown_menu_item':
    case 'unknown_modifier':
    case 'inactive_ingredient':
      return null;
    case 'sale_time_ahead':
      return saleDate > today ? 'sale_date_not_yet' : null;
    case 'no_recipe_in_effect':
      return saleDate < today ? 'past_sale_without_recipe' : null;
    default:
      return 'not_fixable';
  }
}

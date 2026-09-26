// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * What makes an opening-balance line valid, and when a whole document may be posted (#7).
 * Pure: the service checks lines as a draft is saved, and the whole document again when it
 * is posted, because an item or a location may have changed in between.
 */
import {
  decimalPlaces,
  integerDigits,
  parseDecimal,
  sign,
} from '../../../core/quantity/domain/exact-decimal';
import { compareDates, isIsoDate } from '../../../core/time/domain/business-date';

export type LocationType = 'plant' | 'warehouse' | 'branch' | 'in_transit' | 'subcontractor';

/** Stored as NUMERIC(18,3): 15 digits before the point. */
export const QUANTITY_MAX_INTEGER_DIGITS = 15;
/** Stored as NUMERIC(18,6), like a conversion factor (ADR-0019). */
export const UNIT_COST_MAX_DECIMALS = 6;
export const UNIT_COST_MAX_INTEGER_DIGITS = 12;
/** Stored as NUMERIC(18,0). */
export const SECONDARY_QUANTITY_MAX_DIGITS = 18;

export type LineProblem =
  | 'QUANTITY_NOT_A_NUMBER'
  | 'QUANTITY_NOT_POSITIVE'
  | 'QUANTITY_TOO_PRECISE'
  | 'QUANTITY_TOO_LARGE'
  | 'SECONDARY_QUANTITY_NOT_ALLOWED'
  | 'SECONDARY_QUANTITY_INVALID'
  | 'UNIT_COST_NOT_A_NUMBER'
  | 'UNIT_COST_NEGATIVE'
  | 'UNIT_COST_TOO_PRECISE'
  | 'UNIT_COST_TOO_LARGE'
  | 'EXPIRY_NOT_A_DATE';

export interface LineInput {
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
}

export interface LineItem {
  variableWeight: boolean;
  /** The base unit's decimals: 3 for kg, 0 for pieces (ADR-0019). */
  baseUnitDecimals: number;
}

/**
 * What is wrong with one line, or null. The quantity is in the item's base unit, greater than
 * zero and no more precise than that unit allows (ADR-0019: 2.5 pieces is refused, not
 * rounded). A piece count is recorded only for variable-weight items (ADR-0005). The unit cost
 * is an exact decimal, zero or more: stock that cost nothing is entered as 0, never left out.
 */
export function lineProblem(line: LineInput, item: LineItem): LineProblem | null {
  const quantity = parseDecimal(line.quantity);
  if (!quantity) return 'QUANTITY_NOT_A_NUMBER';
  if (sign(quantity) <= 0) return 'QUANTITY_NOT_POSITIVE';
  if (decimalPlaces(quantity) > item.baseUnitDecimals) return 'QUANTITY_TOO_PRECISE';
  if (integerDigits(quantity) > QUANTITY_MAX_INTEGER_DIGITS) return 'QUANTITY_TOO_LARGE';

  if (line.secondaryQuantity !== null) {
    if (!item.variableWeight) return 'SECONDARY_QUANTITY_NOT_ALLOWED';
    const count = parseDecimal(line.secondaryQuantity);
    if (
      !count ||
      sign(count) <= 0 ||
      decimalPlaces(count) > 0 ||
      integerDigits(count) > SECONDARY_QUANTITY_MAX_DIGITS
    ) {
      return 'SECONDARY_QUANTITY_INVALID';
    }
  }

  const cost = parseDecimal(line.unitCost);
  if (!cost) return 'UNIT_COST_NOT_A_NUMBER';
  if (sign(cost) < 0) return 'UNIT_COST_NEGATIVE';
  if (decimalPlaces(cost) > UNIT_COST_MAX_DECIMALS) return 'UNIT_COST_TOO_PRECISE';
  if (integerDigits(cost) > UNIT_COST_MAX_INTEGER_DIGITS) return 'UNIT_COST_TOO_LARGE';

  if (!isIsoDate(line.expiryDate)) return 'EXPIRY_NOT_A_DATE';
  return null;
}

export type LocationProblem = 'LOCATION_SYSTEM_MANAGED' | 'LOCATION_INACTIVE';

/**
 * Where an opening balance may be: a plant, warehouse or branch in use. Never an in-transit
 * location, which only dispatches fill (ADR-0007), nor a reserved type.
 */
export function locationProblem(location: {
  type: LocationType;
  active: boolean;
}): LocationProblem | null {
  if (location.type === 'in_transit' || location.type === 'subcontractor') {
    return 'LOCATION_SYSTEM_MANAGED';
  }
  if (!location.active) return 'LOCATION_INACTIVE';
  return null;
}

export interface PostingCandidate {
  businessDate: string;
  location: { active: boolean };
  lines: Array<{
    lineNo: number;
    expiryDate: string;
    secondaryQuantity: string | null;
    item: { active: boolean; variableWeight: boolean };
  }>;
}

/**
 * The ledger's refusal rules that concern an opening balance: the same names, which the
 * ledger logs and counts (docs/TELEMETRY.md `rule`).
 */
export type OpeningBalanceRule =
  | 'empty_document'
  | 'business_date_in_future'
  | 'inactive_location'
  | 'inactive_item'
  | 'secondary_quantity_not_allowed'
  | 'expired_lot';

export interface Refusal {
  rule: OpeningBalanceRule;
  lineNo?: number;
}

/**
 * The first rule that refuses posting this opening balance today, or null. The stock already
 * exists, so each line's expiry is entered rather than computed; a lot that has already expired
 * on the business date is refused (ADR-0006: expired stock is written off, never brought in).
 */
export function postingRefusal(doc: PostingCandidate, today: string): Refusal | null {
  if (doc.lines.length === 0) return { rule: 'empty_document' };
  if (compareDates(doc.businessDate, today) > 0) return { rule: 'business_date_in_future' };
  if (!doc.location.active) return { rule: 'inactive_location' };
  for (const line of doc.lines) {
    if (!line.item.active) return { rule: 'inactive_item', lineNo: line.lineNo };
    if (line.secondaryQuantity !== null && !line.item.variableWeight) {
      return { rule: 'secondary_quantity_not_allowed', lineNo: line.lineNo };
    }
    if (compareDates(line.expiryDate, doc.businessDate) < 0) {
      return { rule: 'expired_lot', lineNo: line.lineNo };
    }
  }
  return null;
}

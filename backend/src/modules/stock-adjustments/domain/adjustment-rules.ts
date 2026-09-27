// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules of a stock adjustment (#8; docs/GLOSSARY.md "Adjustment", "Write-off"): what makes a
 * line valid, which step may follow which, who may approve, and when a document may be posted.
 * Pure: the service checks lines as a draft is saved, and the whole document again when it is
 * posted, because an item, a location or the date may have changed in between.
 */
import {
  decimalPlaces,
  integerDigits,
  parseDecimal,
  sign,
} from '../../../core/quantity/domain/exact-decimal';
import { compareDates } from '../../../core/time/domain/business-date';

export type LocationType = 'plant' | 'warehouse' | 'branch' | 'in_transit' | 'subcontractor';

export type AdjustmentStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected';

/** Stored as NUMERIC(18,3): 15 digits before the point. */
export const QUANTITY_MAX_INTEGER_DIGITS = 15;
/** Stored as NUMERIC(18,0). */
export const SECONDARY_QUANTITY_MAX_DIGITS = 18;
export const REASON_MAX_LENGTH = 200;
export const REJECTION_REASON_MAX_LENGTH = 500;

export type LineProblem =
  | 'QUANTITY_NOT_A_NUMBER'
  | 'QUANTITY_ZERO'
  | 'QUANTITY_TOO_PRECISE'
  | 'QUANTITY_TOO_LARGE'
  | 'SECONDARY_QUANTITY_NOT_ALLOWED'
  | 'SECONDARY_QUANTITY_INVALID'
  | 'SECONDARY_QUANTITY_SIGN'
  | 'REASON_MISSING'
  | 'REASON_TOO_LONG';

export interface LineInput {
  quantity: string;
  secondaryQuantity: string | null;
  reason: string;
}

export interface LineItem {
  variableWeight: boolean;
  /** The base unit's decimals: 3 for kg, 0 for pieces (ADR-0019). */
  baseUnitDecimals: number;
}

/**
 * What is wrong with one line, or null. The quantity is signed, in the item's base unit: more
 * than zero brings stock in, less takes it out, and zero changes nothing so it is refused. It is
 * no more precise than the unit allows (ADR-0019: 2.5 pieces is refused, not rounded). A piece
 * count is recorded only for variable-weight items (ADR-0005), as a whole number with the same
 * sign as the quantity. Every line says why, so an auditor reading a write-off need not ask.
 */
export function lineProblem(line: LineInput, item: LineItem): LineProblem | null {
  const quantity = parseDecimal(line.quantity);
  if (!quantity) return 'QUANTITY_NOT_A_NUMBER';
  if (sign(quantity) === 0) return 'QUANTITY_ZERO';
  if (decimalPlaces(quantity) > item.baseUnitDecimals) return 'QUANTITY_TOO_PRECISE';
  if (integerDigits(quantity) > QUANTITY_MAX_INTEGER_DIGITS) return 'QUANTITY_TOO_LARGE';

  if (line.secondaryQuantity !== null) {
    if (!item.variableWeight) return 'SECONDARY_QUANTITY_NOT_ALLOWED';
    const count = parseDecimal(line.secondaryQuantity);
    if (
      !count ||
      sign(count) === 0 ||
      decimalPlaces(count) > 0 ||
      integerDigits(count) > SECONDARY_QUANTITY_MAX_DIGITS
    ) {
      return 'SECONDARY_QUANTITY_INVALID';
    }
    if (sign(count) !== sign(quantity)) return 'SECONDARY_QUANTITY_SIGN';
  }

  const reason = line.reason.trim();
  if (reason.length === 0) return 'REASON_MISSING';
  if (reason.length > REASON_MAX_LENGTH) return 'REASON_TOO_LONG';
  return null;
}

export type LocationProblem = 'LOCATION_SYSTEM_MANAGED' | 'LOCATION_INACTIVE';

/**
 * Where an adjustment may be raised: a plant, warehouse or branch in use. Never an in-transit
 * location, which only dispatches and receipts move (ADR-0007), nor a reserved type.
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

export type Step = 'edit' | 'submit' | 'approve' | 'reject' | 'post';

/** The status each step starts from. Posted and rejected are final. */
const STEP_FROM: Record<Step, readonly AdjustmentStatus[]> = {
  edit: ['draft'],
  submit: ['draft'],
  approve: ['submitted'],
  // An approved adjustment the ledger refused (the stock had gone) can still be turned down.
  reject: ['submitted', 'approved'],
  post: ['approved'],
};

/** Whether a document in `status` can take `step`. */
export function stepAllowed(status: AdjustmentStatus, step: Step): boolean {
  return STEP_FROM[step].includes(status);
}

/**
 * Nobody approves a document they created, whatever roles they hold (ADR-0008 decision 3). The
 * service calls this on every approval; the console only mirrors it.
 */
export function segregationProblem(
  document: { createdById: string },
  approverId: string,
): 'self_approval' | null {
  return document.createdById === approverId ? 'self_approval' : null;
}

export interface PostingCandidate {
  businessDate: string;
  location: { active: boolean };
  lines: Array<{
    lineNo: number;
    quantity: string;
    secondaryQuantity: string | null;
    item: { active: boolean; variableWeight: boolean };
    lot: { expiryDate: string };
  }>;
}

/**
 * The ledger's refusal rules that concern an adjustment: the same names, which the ledger logs
 * and counts (docs/TELEMETRY.md `rule`). Whether a lot would go below zero is the ledger's own
 * check, made with the balance rows locked.
 */
export type AdjustmentRule =
  | 'empty_document'
  | 'business_date_in_future'
  | 'inactive_location'
  | 'inactive_item'
  | 'secondary_quantity_not_allowed'
  | 'expired_lot';

export interface Refusal {
  rule: AdjustmentRule;
  lineNo?: number;
}

/**
 * The first rule that refuses posting this adjustment today, or null. An expired lot can be
 * written off (decreased) but never increased: stock past its date is taken out, never put
 * back (ADR-0006).
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
    const increase = !line.quantity.trim().startsWith('-');
    if (increase && compareDates(line.lot.expiryDate, doc.businessDate) < 0) {
      return { rule: 'expired_lot', lineNo: line.lineNo };
    }
  }
  return null;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules of a goods receipt (#11; docs/GLOSSARY.md "Goods receipt", "Return to supplier";
 * ADR-0007, ADR-0014, ADR-0025): what makes a line valid, how much of it is accepted, which
 * expiry its lot takes, how much may be received against an order line, when an order line is
 * complete, and which step may follow which. Pure: the service applies them as a draft is saved,
 * on submission and again inside the posting transaction. The inspection itself is the shared
 * model in `core/receiving/domain/inspection.ts`.
 */
import {
  add,
  decimalPlaces,
  formatFixed,
  integerDigits,
  multiply,
  negate,
  parseDecimal,
  sign,
  type ExactDecimal,
} from '../../../core/quantity/domain/exact-decimal';
import {
  CONDITIONS,
  temperatureProblem,
  type Finding,
} from '../../../core/receiving/domain/inspection';
import { addDays, compareDates, isIsoDate } from '../../../core/time/domain/business-date';

export type GoodsReceiptStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected';

/** A reason is long enough to explain a decision and short enough to read on a dock screen. */
export const REASON_MAX_LENGTH = 500;
export const NOTE_MAX_LENGTH = 500;
/** Quantities are stored as NUMERIC(18,3): digits before the point. */
export const QUANTITY_MAX_INTEGER_DIGITS = 15;
/** A piece count is a whole number, stored as NUMERIC(18,0). */
export const PIECES_MAX_DIGITS = 15;

/** Purchase orders a receipt may be raised and posted against (#11). */
export const RECEIVABLE_ORDER_STATUSES: readonly string[] = [
  'approved',
  'sent',
  'partially_received',
];

export type LineProblem =
  | 'COUNTED_NOT_A_NUMBER'
  | 'COUNTED_NOT_POSITIVE'
  | 'COUNTED_TOO_PRECISE'
  | 'COUNTED_TOO_LARGE'
  | 'REJECTED_NOT_A_NUMBER'
  | 'REJECTED_NEGATIVE'
  | 'REJECTED_TOO_PRECISE'
  | 'REJECTED_MORE_THAN_COUNTED'
  | 'PIECES_REQUIRED'
  | 'PIECES_NOT_ALLOWED'
  | 'PIECES_NOT_A_WHOLE_NUMBER'
  | 'PIECES_NOT_POSITIVE'
  | 'REJECTED_PIECES_MORE_THAN_COUNTED'
  | 'PIECES_DO_NOT_MATCH_QUANTITY'
  | 'TEMPERATURE_NOT_A_NUMBER'
  | 'TEMPERATURE_OUT_OF_RANGE'
  | 'TEMPERATURE_TOO_PRECISE'
  | 'CONDITION_UNKNOWN'
  | 'SUPPLIER_EXPIRY_INVALID'
  | 'REASON_TOO_LONG';

/** One receipt line as the receiver enters it, in the unit the receiver counted in. */
export interface LineInput {
  /** What arrived, weighed or counted: 238.4 (kg) or 12 (cases). */
  countedQuantity: string;
  /** How much of it is turned away, in the same unit; "0" when everything is accepted. */
  rejectedQuantity: string;
  /** Variable-weight items only: birds counted, and birds turned away (ADR-0005). */
  countedPieces: string | null;
  rejectedPieces: string | null;
  /** °C, or null when not measured. */
  temperature: string | null;
  condition: string;
  /** YYYY-MM-DD, or null when the supplier printed none. */
  supplierExpiry: string | null;
  reason: string | null;
}

/**
 * What is wrong with one line on its own, or null. The counted quantity is more than zero and no
 * more precise than its unit allows (refused, not rounded: ADR-0019); the rejected part is
 * between zero and what was counted. A variable-weight item records its piece count, and pieces
 * follow weight: anything accepted or rejected has pieces, and no pieces without weight.
 */
export function lineProblem(
  line: LineInput,
  unit: { decimals: number },
  item: { variableWeight: boolean },
): LineProblem | null {
  const counted = parseDecimal(line.countedQuantity);
  if (!counted) return 'COUNTED_NOT_A_NUMBER';
  if (sign(counted) <= 0) return 'COUNTED_NOT_POSITIVE';
  if (decimalPlaces(counted) > unit.decimals) return 'COUNTED_TOO_PRECISE';
  if (integerDigits(counted) > QUANTITY_MAX_INTEGER_DIGITS) return 'COUNTED_TOO_LARGE';

  const rejected = parseDecimal(line.rejectedQuantity);
  if (!rejected) return 'REJECTED_NOT_A_NUMBER';
  if (sign(rejected) < 0) return 'REJECTED_NEGATIVE';
  if (decimalPlaces(rejected) > unit.decimals) return 'REJECTED_TOO_PRECISE';
  if (compare(rejected, counted) > 0) return 'REJECTED_MORE_THAN_COUNTED';

  if (item.variableWeight) {
    if (line.countedPieces === null || line.rejectedPieces === null) return 'PIECES_REQUIRED';
    const countedPieces = wholeNumber(line.countedPieces);
    const rejectedPieces = wholeNumber(line.rejectedPieces);
    if (!countedPieces || !rejectedPieces) return 'PIECES_NOT_A_WHOLE_NUMBER';
    if (sign(countedPieces) <= 0 || sign(rejectedPieces) < 0) return 'PIECES_NOT_POSITIVE';
    if (compare(rejectedPieces, countedPieces) > 0) return 'REJECTED_PIECES_MORE_THAN_COUNTED';
    const acceptedPieces = add(countedPieces, negate(rejectedPieces));
    const accepted = add(counted, negate(rejected));
    if (
      sign(rejected) > 0 !== sign(rejectedPieces) > 0 ||
      sign(accepted) > 0 !== sign(acceptedPieces) > 0
    ) {
      return 'PIECES_DO_NOT_MATCH_QUANTITY';
    }
  } else if (line.countedPieces !== null || line.rejectedPieces !== null) {
    return 'PIECES_NOT_ALLOWED';
  }

  if (line.temperature !== null) {
    const problem = temperatureProblem(line.temperature);
    if (problem) return problem;
  }
  if (!(CONDITIONS as readonly string[]).includes(line.condition)) return 'CONDITION_UNKNOWN';
  if (line.supplierExpiry !== null && !isIsoDate(line.supplierExpiry)) {
    return 'SUPPLIER_EXPIRY_INVALID';
  }
  if (line.reason !== null && line.reason.trim().length > REASON_MAX_LENGTH) {
    return 'REASON_TOO_LONG';
  }
  return null;
}

/** Counted minus rejected, exactly, in the base unit's decimals. */
export function acceptedQuantity(counted: string, rejected: string, decimals: number): string {
  return formatFixed(add(exact(counted), negate(exact(rejected))), decimals);
}

/** Counted pieces minus rejected pieces, or null for an item without a piece count. */
export function acceptedPieces(counted: string | null, rejected: string | null): string | null {
  if (counted === null || rejected === null) return null;
  return formatFixed(add(exact(counted), negate(exact(rejected))), 0);
}

export interface LotExpiry {
  /** The receipt date plus the item's shelf life (ADR-0006). */
  computedExpiry: string;
  /** What the supplier printed, or null. */
  supplierExpiry: string | null;
  /** The earlier of the two: what the lot takes (ADR-0014). */
  expiryDate: string;
  takes: 'computed' | 'supplier';
}

/**
 * The expiry a received lot takes (ADR-0014 decision 1): the earlier of the receipt date plus the
 * item's shelf life and the supplier's date, with both kept so the reason stays visible. Equal
 * dates take the computed one: nothing was shortened.
 */
export function lotExpiry(
  receiptDate: string,
  shelfLifeDays: number,
  supplierExpiry: string | null,
): LotExpiry {
  const computedExpiry = addDays(receiptDate, shelfLifeDays);
  const takesSupplier = supplierExpiry !== null && compareDates(supplierExpiry, computedExpiry) < 0;
  return {
    computedExpiry,
    supplierExpiry,
    expiryDate: takesSupplier ? supplierExpiry : computedExpiry,
    takes: takesSupplier ? 'supplier' : 'computed',
  };
}

/**
 * A line needs a reason when anything about it is outside tolerance, or when part of it is turned
 * away: a return to supplier always says why (ADR-0007 decision 4).
 */
export function reasonRequired(findings: readonly Finding[], rejected: string): boolean {
  return findings.length > 0 || sign(exact(rejected)) > 0;
}

/**
 * The most that may ever be accepted against an order line: what was ordered plus the item's
 * variance limit, or exactly what was ordered when the item has none (#11). Base units.
 */
export function receivableLimit(ordered: string, maxVariancePercent: string | null): ExactDecimal {
  const quantity = exact(ordered);
  if (maxVariancePercent === null) return quantity;
  return add(quantity, percentOf(quantity, exact(maxVariancePercent)));
}

/**
 * Whether accepting `accepting` more on top of `alreadyAccepted` stays within the limit. Checked
 * inside the posting transaction with the order locked, so two receipts posted at once can never
 * together exceed it.
 */
export function withinReceivableLimit(input: {
  ordered: string;
  alreadyAccepted: string;
  accepting: string;
  maxVariancePercent: string | null;
}): boolean {
  const total = add(exact(input.alreadyAccepted), exact(input.accepting));
  return compare(total, receivableLimit(input.ordered, input.maxVariancePercent)) <= 0;
}

/**
 * What a delivery is still expected to bring on an order line: ordered minus accepted so far,
 * never below zero. The inspection compares the counted quantity with it.
 */
export function outstandingQuantity(ordered: string, accepted: string, decimals: number): string {
  const rest = add(exact(ordered), negate(exact(accepted)));
  return formatFixed(sign(rest) < 0 ? ZERO_VALUE : rest, decimals);
}

/**
 * Whether an order line has been received in full: what was accepted is at least what was ordered
 * less the item's variance limit. A delivery of 238.4 kg against 240 kg within a 2% limit
 * completes the line; nobody waits for the last 1.6 kg of a bird delivered by weight.
 */
export function lineComplete(
  ordered: string,
  accepted: string,
  maxVariancePercent: string | null,
): boolean {
  const quantity = exact(ordered);
  const floor =
    maxVariancePercent === null
      ? quantity
      : add(quantity, negate(percentOf(quantity, exact(maxVariancePercent))));
  return compare(exact(accepted), floor) >= 0;
}

/**
 * The order's status after a receipt: received when every line is complete, partially received
 * when anything has been accepted, and unchanged (null) when nothing has: a delivery turned away
 * whole does not start receiving the order, which can still be cancelled.
 */
export function orderStatusAfterReceipt(
  lines: ReadonlyArray<{ complete: boolean; received: string }>,
): 'received' | 'partially_received' | null {
  if (lines.every((line) => line.complete)) return 'received';
  if (lines.every((line) => sign(exact(line.received)) === 0)) return null;
  return 'partially_received';
}

export type Step = 'edit' | 'submit' | 'approve' | 'reject' | 'post';

const STEP_FROM: Record<Step, readonly GoodsReceiptStatus[]> = {
  edit: ['draft'],
  submit: ['draft'],
  approve: ['submitted'],
  // A submitted receipt, or an approved one the ledger refused to post.
  reject: ['submitted', 'approved'],
  post: ['approved'],
};

export function stepAllowed(status: GoodsReceiptStatus, step: Step): boolean {
  return STEP_FROM[step].includes(status);
}

/**
 * Why a receipt cannot be submitted or posted as it stands, naming its line when it is one. The
 * rule names are the `rule` label of `ledger.posting.refused` (docs/TELEMETRY.md).
 */
export type ReceiptRefusal =
  | { rule: 'empty_document' }
  | { rule: 'order_not_receivable' }
  | { rule: 'inactive_location' }
  | { rule: 'inactive_item'; lineNo: number }
  | { rule: 'temperature_required'; lineNo: number }
  | { rule: 'reason_required'; lineNo: number }
  | { rule: 'expired_on_arrival'; lineNo: number }
  | { rule: 'over_receipt'; lineNo: number };

export interface CheckedLine {
  lineNo: number;
  item: { active: boolean };
  temperatureRequired: boolean;
  findings: readonly Finding[];
  rejectedQuantity: string;
  acceptedQuantity: string;
  reason: string | null;
  /** The date the lot would take. */
  expiryDate: string;
  withinReceivableLimit: boolean;
}

/**
 * The first reason this receipt cannot go forward today, or null. Checked on submission and again
 * when posting, because the order, the location or an item may have changed in between, and
 * another receipt against the same order may have posted first.
 */
export function receiptRefusal(receipt: {
  businessDate: string;
  orderStatus: string;
  location: { active: boolean };
  lines: readonly CheckedLine[];
}): ReceiptRefusal | null {
  if (receipt.lines.length === 0) return { rule: 'empty_document' };
  if (!RECEIVABLE_ORDER_STATUSES.includes(receipt.orderStatus)) {
    return { rule: 'order_not_receivable' };
  }
  if (!receipt.location.active) return { rule: 'inactive_location' };
  for (const line of receipt.lines) {
    const lineNo = line.lineNo;
    if (!line.item.active) return { rule: 'inactive_item', lineNo };
    if (line.temperatureRequired) return { rule: 'temperature_required', lineNo };
    if (
      reasonRequired(line.findings, line.rejectedQuantity) &&
      (line.reason === null || line.reason.trim().length === 0)
    ) {
      return { rule: 'reason_required', lineNo };
    }
    // Food the supplier says has already expired never enters stock (ADR-0006): reject it all.
    if (
      sign(exact(line.acceptedQuantity)) > 0 &&
      compareDates(line.expiryDate, receipt.businessDate) < 0
    ) {
      return { rule: 'expired_on_arrival', lineNo };
    }
    if (!line.withinReceivableLimit) return { rule: 'over_receipt', lineNo };
  }
  return null;
}

/** Whether a receipt needs someone else's approval before it posts: any line has a finding. */
export function needsApproval(lines: ReadonlyArray<{ findings: readonly Finding[] }>): boolean {
  return lines.some((line) => line.findings.length > 0);
}

const ZERO_VALUE: ExactDecimal = { units: 0n, scale: 0 };

function percentOf(value: ExactDecimal, percent: ExactDecimal): ExactDecimal {
  const product = multiply(value, percent);
  return { units: product.units, scale: product.scale + 2 };
}

function wholeNumber(text: string): ExactDecimal | null {
  const value = parseDecimal(text);
  if (!value || decimalPlaces(value) > 0 || integerDigits(value) > PIECES_MAX_DIGITS) return null;
  return value;
}

function compare(a: ExactDecimal, b: ExactDecimal): number {
  return sign(add(a, negate(b)));
}

function exact(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new RangeError(`Not a plain decimal: ${text}`);
  return value;
}

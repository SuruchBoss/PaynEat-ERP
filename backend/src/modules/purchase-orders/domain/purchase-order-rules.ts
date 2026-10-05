// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules of a purchase order (#10; docs/GLOSSARY.md "Purchase order", "Approval threshold";
 * ADR-0024): what makes a line valid, how its money is computed and rounded, which step may
 * follow which, and when an order needs a second person. Pure: the service applies them as a
 * draft is saved and again on submission, and goods receipts (#11) will take each line's cost
 * per base unit from here as the lot cost (ADR-0004).
 */
import {
  add,
  decimalPlaces,
  divideRounded,
  formatFixed,
  integerDigits,
  multiply,
  negate,
  parseDecimal,
  roundHalfAwayFromZero,
  sign,
  ZERO,
  type ExactDecimal,
} from '../../../core/quantity/domain/exact-decimal';
import { compareDates, isIsoDate } from '../../../core/time/domain/business-date';

export type PurchaseOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'rejected'
  | 'cancelled';

/** Money (net, VAT, gross, the threshold) has two decimals: satang. */
export const MONEY_DECIMALS = 2;
/** A price per purchase unit may be finer than a satang (0.3750 per gram), up to four decimals. */
export const PRICE_MAX_DECIMALS = 4;
/** A unit cost carries six decimals, like every lot cost (ADR-0004). */
export const UNIT_COST_DECIMALS = 6;
/** A VAT rate is a percentage with at most two decimals: 7, 0, 1.5. */
export const VAT_RATE_MAX_DECIMALS = 2;
/** Quantities are stored as NUMERIC(18,3), prices as NUMERIC(18,4): digits before the point. */
export const QUANTITY_MAX_INTEGER_DIGITS = 15;
export const PRICE_MAX_INTEGER_DIGITS = 14;
export const NOTE_MAX_LENGTH = 500;
export const REASON_MAX_LENGTH = 500;

export type LineProblem =
  | 'QUANTITY_NOT_A_NUMBER'
  | 'QUANTITY_NOT_POSITIVE'
  | 'QUANTITY_TOO_PRECISE'
  | 'QUANTITY_TOO_LARGE'
  | 'PRICE_NOT_A_NUMBER'
  | 'PRICE_NOT_POSITIVE'
  | 'PRICE_TOO_PRECISE'
  | 'PRICE_TOO_LARGE'
  | 'VAT_RATE_NOT_A_NUMBER'
  | 'VAT_RATE_OUT_OF_RANGE'
  | 'VAT_RATE_TOO_PRECISE';

export interface LineInput {
  /** In the purchase unit: 12 cases. */
  quantity: string;
  /** Per purchase unit, before VAT: 1284.00 a case. */
  unitPrice: string;
  /** Percent: "7". */
  vatRate: string;
}

/**
 * What is wrong with one line, or null. The quantity is more than zero and no more precise than
 * its purchase unit allows (2.5 cases is refused, not rounded: ADR-0019). The price is more
 * than zero: a lot received at no cost would carry a cost of zero, which the ERP never invents
 * (ADR-0004). The VAT rate is between 0 and 100 percent.
 */
export function lineProblem(line: LineInput, unit: { decimals: number }): LineProblem | null {
  const quantity = parseDecimal(line.quantity);
  if (!quantity) return 'QUANTITY_NOT_A_NUMBER';
  if (sign(quantity) <= 0) return 'QUANTITY_NOT_POSITIVE';
  if (decimalPlaces(quantity) > unit.decimals) return 'QUANTITY_TOO_PRECISE';
  if (integerDigits(quantity) > QUANTITY_MAX_INTEGER_DIGITS) return 'QUANTITY_TOO_LARGE';

  const price = parseDecimal(line.unitPrice);
  if (!price) return 'PRICE_NOT_A_NUMBER';
  if (sign(price) <= 0) return 'PRICE_NOT_POSITIVE';
  if (decimalPlaces(price) > PRICE_MAX_DECIMALS) return 'PRICE_TOO_PRECISE';
  if (integerDigits(price) > PRICE_MAX_INTEGER_DIGITS) return 'PRICE_TOO_LARGE';

  const rate = parseDecimal(line.vatRate);
  if (!rate) return 'VAT_RATE_NOT_A_NUMBER';
  if (sign(rate) < 0 || compare(rate, HUNDRED) > 0) return 'VAT_RATE_OUT_OF_RANGE';
  if (decimalPlaces(rate) > VAT_RATE_MAX_DECIMALS) return 'VAT_RATE_TOO_PRECISE';
  return null;
}

export interface PricedLine extends LineInput {
  /** Whether the company claims this VAT back. Recoverable VAT is not a cost (ADR-0024). */
  vatRecoverable: boolean;
  /** Base units in one purchase unit: 20 (kg in a case). */
  factor: string;
  /** The base unit's decimals: 3 for kg, 0 for pieces (ADR-0019). */
  baseUnitDecimals: number;
}

export interface LineTotals {
  /** Quantity × price, rounded once to satang. */
  net: string;
  /** Net × rate, rounded once to satang. */
  vat: string;
  /** Net + VAT: what the line commits the company to pay. */
  gross: string;
  /** Quantity × factor, rounded once to the base unit's decimals (ADR-0019). */
  baseQuantity: string;
  /**
   * The cost of one base unit: the price per purchase unit plus the VAT that is not recovered,
   * divided by the factor, rounded once to six decimals. Goods receipts set lot cost from it.
   */
  unitCost: string;
}

/**
 * One line's money, with rounding defined once (ADR-0024): every amount is computed exactly and
 * rounded a single time, half away from zero, at the line — net and VAT to satang, the base
 * quantity to its unit, the unit cost to six decimals. VAT is charged on the rounded net, as the
 * supplier's invoice does. The unit cost is computed from the price rather than from the rounded
 * net, so it does not depend on how many units the line orders.
 *
 * Worked example (ADR-0024): 12 cases of whole chicken at 1,284.00 a case, 7% VAT recoverable,
 * a case is 20 kg: net 15,408.00, VAT 1,078.56, gross 16,486.56, 240.000 kg at 64.200000 a kg.
 * The same line with VAT not recoverable costs 1,373.88 / 20 = 68.694000 a kg.
 */
export function lineTotals(line: PricedLine): LineTotals {
  const quantity = exact(line.quantity);
  const price = exact(line.unitPrice);
  const rate = exact(line.vatRate);
  const factor = exact(line.factor);

  const net = roundHalfAwayFromZero(multiply(quantity, price), MONEY_DECIMALS);
  const vat = divideRounded(multiply(net, rate), HUNDRED, MONEY_DECIMALS);
  const gross = add(net, vat);
  const baseQuantity = roundHalfAwayFromZero(multiply(quantity, factor), line.baseUnitDecimals);
  const costRate = line.vatRecoverable ? HUNDRED : add(HUNDRED, rate);
  const unitCost = divideRounded(
    multiply(price, costRate),
    multiply(HUNDRED, factor),
    UNIT_COST_DECIMALS,
  );

  return {
    net: formatFixed(net, MONEY_DECIMALS),
    vat: formatFixed(vat, MONEY_DECIMALS),
    gross: formatFixed(gross, MONEY_DECIMALS),
    baseQuantity: formatFixed(baseQuantity, line.baseUnitDecimals),
    unitCost: formatFixed(unitCost, UNIT_COST_DECIMALS),
  };
}

export interface OrderTotals {
  net: string;
  vat: string;
  gross: string;
}

/**
 * The order's totals: the sums of its lines' rounded amounts, never a second rounding, so the
 * lines of a printed order always add up to its total.
 */
export function orderTotals(lines: readonly Pick<LineTotals, 'net' | 'vat'>[]): OrderTotals {
  const net = lines.reduce((sum, line) => add(sum, exact(line.net)), ZERO);
  const vat = lines.reduce((sum, line) => add(sum, exact(line.vat)), ZERO);
  return {
    net: formatFixed(net, MONEY_DECIMALS),
    vat: formatFixed(vat, MONEY_DECIMALS),
    gross: formatFixed(add(net, vat), MONEY_DECIMALS),
  };
}

/**
 * Whether an order needs a purchasing approver: its gross total (what the company commits to
 * pay, VAT included) is above the threshold. At or below it, submitting approves it (ADR-0024).
 */
export function needsApproval(grossTotal: string, threshold: string): boolean {
  return compare(exact(grossTotal), exact(threshold)) > 0;
}

export type Step = 'edit' | 'submit' | 'approve' | 'reject' | 'send' | 'cancel';

/**
 * The status each step starts from. Receiving (#11) moves a sent order to partially received
 * and received. Rejected, cancelled and received are final; an order is cancelled only before
 * anything has been received against it.
 */
const STEP_FROM: Record<Step, readonly PurchaseOrderStatus[]> = {
  edit: ['draft'],
  submit: ['draft'],
  approve: ['submitted'],
  reject: ['submitted'],
  send: ['approved'],
  cancel: ['draft', 'submitted', 'approved', 'sent'],
};

/** Whether an order in `status` can take `step`. */
export function stepAllowed(status: PurchaseOrderStatus, step: Step): boolean {
  return STEP_FROM[step].includes(status);
}

/** Inactive suppliers and items cannot be ordered (#10). */
export type OrderRefusal =
  | { rule: 'empty_order' }
  | { rule: 'inactive_supplier' }
  | { rule: 'inactive_location' }
  | { rule: 'location_not_receiving' }
  | { rule: 'inactive_item'; lineNo: number }
  | { rule: 'unit_not_purchase_unit'; lineNo: number };

export interface SubmissionCandidate {
  supplier: { active: boolean };
  location: { active: boolean; type: string };
  lines: Array<{ lineNo: number; item: { active: boolean }; unitIsPurchaseUnit: boolean }>;
}

/**
 * The first reason this order cannot be submitted today, or null. Checked again on submission,
 * because a supplier, item or location may have been deactivated since the draft was saved.
 * Only a plant or a warehouse receives supplier goods (#10, ADR-0007).
 */
export function submissionRefusal(order: SubmissionCandidate): OrderRefusal | null {
  if (order.lines.length === 0) return { rule: 'empty_order' };
  if (!order.supplier.active) return { rule: 'inactive_supplier' };
  if (!order.location.active) return { rule: 'inactive_location' };
  if (!RECEIVING_TYPES.includes(order.location.type)) return { rule: 'location_not_receiving' };
  for (const line of order.lines) {
    if (!line.item.active) return { rule: 'inactive_item', lineNo: line.lineNo };
    if (!line.unitIsPurchaseUnit) return { rule: 'unit_not_purchase_unit', lineNo: line.lineNo };
  }
  return null;
}

/**
 * The expected delivery date is a real business date, today or later (ADR-0018). Checked when
 * a draft is saved and again on submission: a draft can wait past its own date.
 */
export function deliveryDateProblem(
  date: string,
  today: string,
): 'DELIVERY_DATE_INVALID' | 'DELIVERY_DATE_PAST' | null {
  if (!isIsoDate(date)) return 'DELIVERY_DATE_INVALID';
  if (compareDates(date, today) < 0) return 'DELIVERY_DATE_PAST';
  return null;
}

/** Where supplier goods are delivered: a plant or a warehouse, never a branch (#10). */
export const RECEIVING_TYPES: readonly string[] = ['plant', 'warehouse'];

const HUNDRED: ExactDecimal = { units: 100n, scale: 0 };

function compare(a: ExactDecimal, b: ExactDecimal): number {
  return sign(add(a, negate(b)));
}

function exact(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new RangeError(`Not a plain decimal: ${text}`);
  return value;
}

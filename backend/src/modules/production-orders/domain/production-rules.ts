// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Production orders (#13, ADR-0004, ADR-0006, ADR-0014, ADR-0027) as pure functions: what an
 * order plans from its BOM version, what its recorded actuals yield, what each output lot costs
 * and when it expires, and why an order cannot post.
 *
 * Cost allocation follows ADR-0027. The value of the consumed input lots is split across the
 * outputs by the BOM's ratios exactly (the ratios add up to 100.00, so the shares add up to the
 * input value to the last digit). The one rounding is the output lot's unit cost, half up to six
 * decimals; what that rounding moves is kept per output as its rounding difference, so the lot
 * values and the differences together equal the input value exactly.
 */
import {
  add,
  decimalPlaces,
  divideRounded,
  formatFixed,
  formatMinimal,
  integerDigits,
  multiply,
  negate,
  parseDecimal,
  sign,
  ZERO,
  type ExactDecimal,
} from '../../../core/quantity/domain/exact-decimal';
import { addDays, compareDates } from '../../../core/time/domain/business-date';

/** A lot's unit cost keeps six decimals (NUMERIC(18,6), ADR-0019). */
export const UNIT_COST_DECIMALS = 6;
/** Yields are percentages to 0.01 %. */
const PERCENT_DECIMALS = 2;
/** Twelve digits before the point: more than any real order, less than NUMERIC(18,3) holds. */
const MAX_INTEGER_DIGITS = 12;
/** A weight is kept to the gram. */
const WEIGHT_DECIMALS = 3;
const HUNDRED: ExactDecimal = { units: 100n, scale: 0 };

/** Units whose quantity is itself a weight, and how many kg one of it is. */
const WEIGHT_UNITS: ReadonlyMap<string, ExactDecimal> = new Map([
  ['kg', { units: 1n, scale: 0 }],
  ['g', { units: 1n, scale: 3 }],
]);

export interface OrderItemFacts {
  baseUnitCode: string;
  /** Decimals a quantity in the item's base unit keeps (ADR-0019). */
  baseUnitDecimals: number;
  variableWeight: boolean;
}

// --- Planning ----------------------------------------------------------------------------

export interface BomLine {
  itemId: string;
  /** Per batch, in the item's base unit. */
  quantity: string;
  /** Per batch, in kg; set for items not counted in kg or g. */
  expectedWeightKg: string | null;
}

export interface PlannedLine {
  itemId: string;
  /** In the item's base unit, rounded half up to its decimals: a plan, not a measurement. */
  quantity: string;
}

export type PlannedQuantityProblem = 'not_a_decimal' | 'not_positive' | 'too_many_decimals';

/**
 * Whether a planned quantity of the BOM's first input (the order's "cut 500 kg of whole chicken")
 * is one the item can hold: a positive decimal with no more decimals than its base unit keeps.
 */
export function plannedQuantityProblem(
  text: string,
  item: Pick<OrderItemFacts, 'baseUnitDecimals'>,
): PlannedQuantityProblem | null {
  const value = parseDecimal(text);
  if (!value) return 'not_a_decimal';
  if (sign(value) <= 0) return 'not_positive';
  if (decimalPlaces(value) > item.baseUnitDecimals) return 'too_many_decimals';
  if (integerDigits(value) > MAX_INTEGER_DIGITS) return 'not_a_decimal';
  return null;
}

/**
 * Every BOM line scaled to the order: the BOM's batch scaled so its first input is the planned
 * quantity. Each line is rounded half up to its item's decimals; the outputs are the BOM's
 * expected yield at that scale, which the order shows as its plan.
 */
export function plannedLines(
  inputs: readonly BomLine[],
  outputs: readonly BomLine[],
  plannedQuantity: string,
  items: ReadonlyMap<string, OrderItemFacts>,
): { inputs: PlannedLine[]; outputs: PlannedLine[] } {
  if (inputs.length === 0) throw new RangeError('A BOM has at least one input');
  const planned = decimal(plannedQuantity);
  const batch = decimal(inputs[0].quantity);
  const scale = (line: BomLine): PlannedLine => {
    const item = items.get(line.itemId);
    if (!item) throw new Error(`unknown item ${line.itemId}`);
    const quantity = divideRounded(
      multiply(decimal(line.quantity), planned),
      batch,
      item.baseUnitDecimals,
    );
    return { itemId: line.itemId, quantity: formatMinimal(quantity) };
  };
  return { inputs: inputs.map(scale), outputs: outputs.map(scale) };
}

// --- Recorded actuals --------------------------------------------------------------------

export type ActualProblem =
  | 'not_a_decimal'
  | 'negative'
  | 'too_many_decimals'
  | 'too_large'
  /** A piece count on an item that is not variable-weight (ADR-0005). */
  | 'pieces_not_allowed'
  | 'pieces_invalid'
  /** The item is counted in kg or g: its quantity is its weight. */
  | 'weight_not_needed'
  | 'weight_invalid';

/**
 * Whether an output's recorded actuals are well formed. A zero quantity is allowed here (the
 * person may be recording what really came out) and refused only when the order posts, with
 * its own reason (`zero_output_quantity`).
 */
export function actualProblem(
  actual: { quantity: string; pieces: string | null; weightKg: string | null },
  item: OrderItemFacts,
): ActualProblem | null {
  const quantity = parseDecimal(actual.quantity);
  if (!quantity) return 'not_a_decimal';
  if (sign(quantity) < 0) return 'negative';
  if (decimalPlaces(quantity) > item.baseUnitDecimals) return 'too_many_decimals';
  if (integerDigits(quantity) > MAX_INTEGER_DIGITS) return 'too_large';
  if (actual.pieces !== null) {
    if (!item.variableWeight) return 'pieces_not_allowed';
    const pieces = parseDecimal(actual.pieces);
    if (
      !pieces ||
      sign(pieces) < 0 ||
      decimalPlaces(pieces) > 0 ||
      integerDigits(pieces) > MAX_INTEGER_DIGITS
    ) {
      return 'pieces_invalid';
    }
  }
  if (actual.weightKg !== null) {
    if (isWeightUnit(item.baseUnitCode)) return 'weight_not_needed';
    if (!validWeight(actual.weightKg)) return 'weight_invalid';
  }
  return null;
}

/** Whether an item counted in this unit weighs its quantity, so it records no weight. */
export function isWeightUnit(unitCode: string): boolean {
  return WEIGHT_UNITS.has(unitCode);
}

function validWeight(text: string): boolean {
  const weight = parseDecimal(text);
  return (
    weight !== null &&
    sign(weight) >= 0 &&
    decimalPlaces(weight) <= WEIGHT_DECIMALS &&
    integerDigits(weight) <= MAX_INTEGER_DIGITS
  );
}

/**
 * A line's weight in kg: its quantity for an item counted in kg or g, else the weight the
 * supervisor measured. Null when an item that is not counted by weight has no measured weight:
 * the ERP never estimates a weight it presents as measured.
 */
export function measuredWeightKg(
  quantity: string,
  weightKg: string | null,
  item: Pick<OrderItemFacts, 'baseUnitCode'>,
): ExactDecimal | null {
  const perUnit = WEIGHT_UNITS.get(item.baseUnitCode);
  if (perUnit) return multiply(decimal(quantity), perUnit);
  return weightKg === null ? null : decimal(weightKg);
}

// --- Yield -------------------------------------------------------------------------------

export interface YieldInput {
  /** Measured input weight in kg; null when an input's weight was not measured. */
  inputWeightKg: ExactDecimal | null;
  /** Per output, measured weight in kg, or null when not measured. */
  outputWeightsKg: ReadonlyArray<ExactDecimal | null>;
  /** The BOM version's expected weights per batch. */
  expected: { inputWeightKg: ExactDecimal; outputWeightsKg: readonly ExactDecimal[] };
}

export interface OutputYield {
  /** Percent to 0.01 %: this output's weight over the input weight. */
  expected: string;
  /** Null until both the input and this output have a measured weight. */
  actual: string | null;
  /** Actual less expected, percentage points to 0.01; null when actual is. */
  difference: string | null;
}

export interface ProductionYield {
  overall: OutputYield;
  outputs: OutputYield[];
}

/**
 * Actual yield per output and overall against the BOM's expected yield (docs/GLOSSARY.md
 * "Yield": output weight ÷ input weight). A poor cut shows here before it posts, and again as a
 * higher unit cost after.
 */
export function productionYield(input: YieldInput): ProductionYield {
  const { expected } = input;
  const expectedOverall = expected.outputWeightsKg.reduce(add, ZERO);
  const measuredAll = input.outputWeightsKg.every((w) => w !== null);
  const overallActual = measuredAll
    ? (input.outputWeightsKg as ExactDecimal[]).reduce(add, ZERO)
    : null;
  return {
    overall: yieldOf(expectedOverall, expected.inputWeightKg, overallActual, input.inputWeightKg),
    outputs: expected.outputWeightsKg.map((weight, index) =>
      yieldOf(
        weight,
        expected.inputWeightKg,
        input.outputWeightsKg[index] ?? null,
        input.inputWeightKg,
      ),
    ),
  };
}

function yieldOf(
  expectedOut: ExactDecimal,
  expectedIn: ExactDecimal,
  actualOut: ExactDecimal | null,
  actualIn: ExactDecimal | null,
): OutputYield {
  const expected = percent(expectedOut, expectedIn);
  if (actualOut === null || actualIn === null || sign(actualIn) <= 0) {
    return { expected: formatFixed(expected, PERCENT_DECIMALS), actual: null, difference: null };
  }
  const actual = percent(actualOut, actualIn);
  return {
    expected: formatFixed(expected, PERCENT_DECIMALS),
    actual: formatFixed(actual, PERCENT_DECIMALS),
    difference: formatFixed(add(actual, negate(expected)), PERCENT_DECIMALS),
  };
}

function percent(part: ExactDecimal, whole: ExactDecimal): ExactDecimal {
  if (sign(whole) <= 0) throw new RangeError('A yield needs an input weight above zero');
  return divideRounded(multiply(part, HUNDRED), whole, PERCENT_DECIMALS);
}

// --- Cost allocation (ADR-0004, ADR-0027) -----------------------------------------------

export interface ConsumedLot {
  /** In the item's base unit, above zero. */
  quantity: string;
  /** The lot's own unit cost (ADR-0004). */
  unitCost: string;
}

export interface OutputToCost {
  /** The BOM version's allocation ratio, percent with two decimals. */
  ratio: string;
  /** The actual quantity, in the output item's base unit. */
  quantity: string;
}

export interface CostedOutput {
  /** Input value × ratio ÷ 100, exact: every digit kept. */
  allocatedValue: string;
  /** Allocated value ÷ quantity, half up to six decimals: the output lot's unit cost. */
  unitCost: string;
  /** Quantity × unit cost, exact: what the output lot is worth in the ledger. */
  lotValue: string;
  /** Allocated value less lot value: what rounding the unit cost moved, exact. */
  roundingDifference: string;
}

export type CostAllocation =
  | { ok: true; inputValue: string; outputs: CostedOutput[] }
  | { ok: false; problem: 'zero_output_quantity'; outputIndex: number };

/**
 * Splits the value of the consumed input lots across the outputs (ADR-0004 decision 3,
 * ADR-0027): each output's share is the input value × its ratio ÷ 100, kept exactly, and its
 * lot's unit cost is that share ÷ its actual quantity, rounded half up to six decimals. Waste
 * has no share, so a poor yield divides the same value by less and raises the unit cost. An
 * output with no actual quantity cannot carry a cost, so the allocation is refused rather than
 * dividing by zero.
 *
 * For every allocation, Σ lot values + Σ rounding differences = input value exactly, and each
 * output's |rounding difference| ≤ its quantity × 0.0000005.
 */
export function allocateCost(
  consumed: readonly ConsumedLot[],
  outputs: readonly OutputToCost[],
): CostAllocation {
  const ratioTotal = outputs.map((o) => decimal(o.ratio)).reduce(add, ZERO);
  if (sign(add(ratioTotal, negate(HUNDRED))) !== 0) {
    throw new RangeError('The allocation ratios must add up to exactly 100');
  }
  const zero = outputs.findIndex((o) => sign(decimal(o.quantity)) <= 0);
  if (zero >= 0) return { ok: false, problem: 'zero_output_quantity', outputIndex: zero };

  const inputValue = consumed
    .map((lot) => multiply(decimal(lot.quantity), decimal(lot.unitCost)))
    .reduce(add, ZERO);
  return {
    ok: true,
    inputValue: formatMinimal(inputValue),
    outputs: outputs.map((output) => {
      const ratio = decimal(output.ratio);
      // ÷ 100 is exact: the same digits, two places further right.
      const allocated = shift(multiply(inputValue, ratio), 2);
      const quantity = decimal(output.quantity);
      const unitCost = divideRounded(allocated, quantity, UNIT_COST_DECIMALS);
      const lotValue = multiply(quantity, unitCost);
      return {
        allocatedValue: formatMinimal(allocated),
        unitCost: formatFixed(unitCost, UNIT_COST_DECIMALS),
        lotValue: formatMinimal(lotValue),
        roundingDifference: formatMinimal(add(allocated, negate(lotValue))),
      };
    }),
  };
}

function shift(value: ExactDecimal, places: number): ExactDecimal {
  return { units: value.units, scale: value.scale + places };
}

// --- Output expiry (ADR-0014) ------------------------------------------------------------

export interface OutputExpiry {
  /** The lot's expiry: the earlier of the two below. */
  expiryDate: string;
  /** The production date plus the output item's shelf life. */
  computedExpiryDate: string;
  /** The earliest expiry of the lots the order consumed. */
  earliestInputExpiryDate: string;
}

/**
 * An output lot expires at the production date plus its item's shelf life, but never later
 * than the earliest input lot the order consumed: cutting a chicken does not make it last
 * longer than the chicken would have (ADR-0014).
 */
export function outputExpiry(
  businessDate: string,
  shelfLifeDays: number,
  consumedExpiryDates: readonly string[],
): OutputExpiry {
  if (consumedExpiryDates.length === 0) throw new RangeError('An order consumes at least one lot');
  const computedExpiryDate = addDays(businessDate, shelfLifeDays);
  const earliestInputExpiryDate = [...consumedExpiryDates].sort(compareDates)[0];
  return {
    expiryDate:
      compareDates(earliestInputExpiryDate, computedExpiryDate) < 0
        ? earliestInputExpiryDate
        : computedExpiryDate,
    computedExpiryDate,
    earliestInputExpiryDate,
  };
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}

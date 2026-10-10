// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Production BOMs (#12, ADR-0004, ADR-0026): what one batch of a production order consumes
 * and what it expects to yield, and how the batch's cost is split across its outputs.
 *
 * Everything is compared by weight in kilograms. A kg item weighs its quantity, a g item a
 * thousandth of it; any other unit (pieces, litres, packs) states the weight it expects
 * per batch. The default allocation ratio of an output is its share of the expected output
 * weight, to 0.01 %, rounded by largest remainder so the ratios add up to exactly 100.00.
 * Waste is input weight less expected output weight and carries no ratio: its cost stays
 * with the outputs.
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

/** Which side of the batch a line is on. */
export type BomSide = 'input' | 'output';

export interface BomLineInput {
  itemId: string;
  /** Per batch, in the item's base unit, as a decimal string (ADR-0019). */
  quantity: string;
  /**
   * Expected weight of the line per batch, in kg. Required for items whose base unit is not
   * a weight (pieces, litres, packs); refused for kg and g items, which weigh their quantity.
   */
  expectedWeightKg?: string | null;
}

export interface BomOutputInput extends BomLineInput {
  /** An overriding allocation ratio in percent; all outputs carry one, or none does. */
  allocationRatio?: string | null;
}

export interface BomItemFacts {
  active: boolean;
  baseUnitCode: string;
  /** Decimals a quantity in the item's base unit keeps (ADR-0019). */
  baseUnitDecimals: number;
}

export type BomLineProblem =
  | 'unknown_item'
  | 'inactive_item'
  /** The item is on this side already. */
  | 'duplicate_item'
  /** An output that is also an input: the batch would consume what it makes. */
  | 'on_both_sides'
  | 'not_a_decimal'
  | 'not_positive'
  | 'too_many_decimals'
  | 'too_large'
  /** The item is not counted in kg or g, so its expected weight is needed. */
  | 'weight_missing'
  /** The item is counted in kg or g: its quantity is its weight. */
  | 'weight_not_needed'
  | 'weight_invalid'
  | 'ratio_invalid';

export interface BomLineIssue {
  side: BomSide;
  /** 1-based, as the person counts lines on that side. */
  lineNo: number;
  problem: BomLineProblem;
}

export type BomProblem =
  | 'no_inputs'
  | 'no_outputs'
  /** The outputs are expected to weigh more than the inputs: the batch cannot gain weight. */
  | 'outputs_heavier_than_inputs'
  /** Some outputs carry a ratio and some do not: override all of them, or none. */
  | 'ratios_incomplete'
  /** The overriding ratios do not add up to exactly 100.00. */
  | 'ratios_not_100'
  /**
   * With no overriding ratios, an output's share of the expected output weight comes out at
   * 0.00 % after the cut to 0.01 %, so it would carry no cost without anyone choosing that.
   */
  | 'default_ratio_zero';

export interface BomIssues {
  lines: BomLineIssue[];
  problems: BomProblem[];
  /** The 1-based output lines whose default ratio is 0.00, when `default_ratio_zero`. */
  zeroRatioOutputs: number[];
}

/** Twelve digits before the point: more than any real batch, less than NUMERIC(18,6) holds. */
const MAX_INTEGER_DIGITS = 12;
/** A weight is kept to the gram. */
const WEIGHT_DECIMALS = 3;
/** Ratios are percentages to 0.01 %. */
const RATIO_DECIMALS = 2;
const HUNDRED: ExactDecimal = { units: 100n, scale: 0 };
const PER_GRAM: ExactDecimal = { units: 1n, scale: 3 };

/** Units whose quantity is itself a weight, and how many kg one of it is. */
const WEIGHT_UNITS: ReadonlyMap<string, ExactDecimal> = new Map([
  ['kg', { units: 1n, scale: 0 }],
  ['g', PER_GRAM],
]);

/** Whether an item counted in this unit weighs its quantity, so it states no weight. */
export function isWeightUnit(unitCode: string): boolean {
  return WEIGHT_UNITS.has(unitCode);
}

/**
 * Everything wrong with a version's lines, at most one issue per line, and with the version
 * as a whole. Version-wide checks that need weights (heavier outputs, ratio totals, a default
 * ratio of zero) run only when every line is valid, so one mistake is not reported three times.
 */
export function bomIssues(
  inputs: readonly BomLineInput[],
  outputs: readonly BomOutputInput[],
  items: ReadonlyMap<string, BomItemFacts>,
): BomIssues {
  const lines: BomLineIssue[] = [];
  const problems: BomProblem[] = [];
  const zeroRatioOutputs: number[] = [];
  if (inputs.length === 0) problems.push('no_inputs');
  if (outputs.length === 0) problems.push('no_outputs');

  const inputIds = new Set(inputs.map((line) => line.itemId));
  const check = (side: BomSide, list: readonly BomLineInput[]) => {
    const seen = new Set<string>();
    list.forEach((line, index) => {
      const problem = lineProblem(side, line, items, seen, inputIds);
      seen.add(line.itemId);
      if (problem) lines.push({ side, lineNo: index + 1, problem });
    });
  };
  check('input', inputs);
  check('output', outputs);

  const withRatio = outputs.filter((line) => hasText(line.allocationRatio)).length;
  if (withRatio > 0 && withRatio < outputs.length) problems.push('ratios_incomplete');
  outputs.forEach((line, index) => {
    if (!hasText(line.allocationRatio)) return;
    if (ratioValue(line.allocationRatio) === null && !lines.some(sameLine('output', index))) {
      lines.push({ side: 'output', lineNo: index + 1, problem: 'ratio_invalid' });
    }
  });

  if (lines.length === 0 && inputs.length > 0 && outputs.length > 0) {
    const figures = bomFigures(inputs, outputs, items);
    if (sign(figures.waste) < 0) problems.push('outputs_heavier_than_inputs');
    if (withRatio === outputs.length) {
      const total = outputs.reduce(
        (sum, line) => add(sum, ratioValue(line.allocationRatio) ?? ZERO),
        ZERO,
      );
      if (sign(add(total, negate(HUNDRED))) !== 0) problems.push('ratios_not_100');
    }
    if (withRatio === 0) {
      defaultRatios(figures.outputWeights).forEach((ratio, index) => {
        if (sign(decimal(ratio)) === 0) zeroRatioOutputs.push(index + 1);
      });
      if (zeroRatioOutputs.length > 0) problems.push('default_ratio_zero');
    }
  }
  return { lines, problems, zeroRatioOutputs };
}

function lineProblem(
  side: BomSide,
  line: BomLineInput,
  items: ReadonlyMap<string, BomItemFacts>,
  seen: ReadonlySet<string>,
  inputIds: ReadonlySet<string>,
): BomLineProblem | null {
  const item = items.get(line.itemId);
  if (!item) return 'unknown_item';
  if (!item.active) return 'inactive_item';
  if (seen.has(line.itemId)) return 'duplicate_item';
  if (side === 'output' && inputIds.has(line.itemId)) return 'on_both_sides';
  const quantity = parseDecimal(line.quantity);
  if (!quantity) return 'not_a_decimal';
  if (sign(quantity) <= 0) return 'not_positive';
  if (decimalPlaces(quantity) > item.baseUnitDecimals) return 'too_many_decimals';
  if (integerDigits(quantity) > MAX_INTEGER_DIGITS) return 'too_large';
  if (isWeightUnit(item.baseUnitCode)) {
    return hasText(line.expectedWeightKg) ? 'weight_not_needed' : null;
  }
  if (!hasText(line.expectedWeightKg)) return 'weight_missing';
  const weight = parseDecimal(line.expectedWeightKg);
  if (
    !weight ||
    sign(weight) <= 0 ||
    decimalPlaces(weight) > WEIGHT_DECIMALS ||
    integerDigits(weight) > MAX_INTEGER_DIGITS
  ) {
    return 'weight_invalid';
  }
  return null;
}

/** A positive percentage to 0.01 %, at most 100; null when the text is not one. */
function ratioValue(text: string | null | undefined): ExactDecimal | null {
  const value = hasText(text) ? parseDecimal(text) : null;
  if (!value || sign(value) <= 0 || decimalPlaces(value) > RATIO_DECIMALS) return null;
  if (sign(add(value, negate(HUNDRED))) > 0) return null;
  return value;
}

const hasText = (text: string | null | undefined): text is string =>
  text !== null && text !== undefined && text !== '';

const sameLine = (side: BomSide, index: number) => (issue: BomLineIssue) =>
  issue.side === side && issue.lineNo === index + 1;

/** A valid line's weight per batch, in kg. Call only on lines `bomIssues` accepted. */
export function lineWeightKg(line: BomLineInput, item: BomItemFacts): ExactDecimal {
  const perUnit = WEIGHT_UNITS.get(item.baseUnitCode);
  if (perUnit) return multiply(decimal(line.quantity), perUnit);
  return decimal(line.expectedWeightKg ?? '');
}

export interface BomFigures {
  inputWeight: ExactDecimal;
  outputWeight: ExactDecimal;
  /** Input weight less expected output weight; below zero when the outputs are heavier. */
  waste: ExactDecimal;
  /** Per output, in input order. */
  outputWeights: ExactDecimal[];
}

/** The weights of a version whose lines are all valid. */
export function bomFigures(
  inputs: readonly BomLineInput[],
  outputs: readonly BomLineInput[],
  items: ReadonlyMap<string, BomItemFacts>,
): BomFigures {
  const weigh = (line: BomLineInput) => {
    const item = items.get(line.itemId);
    if (!item) throw new Error(`unknown item ${line.itemId}`);
    return lineWeightKg(line, item);
  };
  const inputWeight = inputs.map(weigh).reduce(add, ZERO);
  const outputWeights = outputs.map(weigh);
  const outputWeight = outputWeights.reduce(add, ZERO);
  return {
    inputWeight,
    outputWeight,
    waste: add(inputWeight, negate(outputWeight)),
    outputWeights,
  };
}

/** Expected yield in percent, to 0.01 %: expected output weight over input weight. */
export function yieldPercent(figures: Pick<BomFigures, 'inputWeight' | 'outputWeight'>): string {
  if (sign(figures.inputWeight) <= 0) throw new RangeError('A batch has no input weight');
  return formatFixed(
    divideRounded(multiply(figures.outputWeight, HUNDRED), figures.inputWeight, RATIO_DECIMALS),
    RATIO_DECIMALS,
  );
}

/**
 * Each output's share of the expected output weight, in percent to 0.01 %, adding up to
 * exactly 100.00. Every share is cut down to 0.01 %; the hundredths still missing go one each
 * to the outputs that lost the most in the cut, and on a tie to the earlier line.
 */
export function defaultRatios(outputWeights: readonly ExactDecimal[]): string[] {
  if (outputWeights.length === 0) return [];
  const scale = Math.max(...outputWeights.map((w) => w.scale));
  const units = outputWeights.map((w) => w.units * 10n ** BigInt(scale - w.scale));
  const total = units.reduce((sum, u) => sum + u, 0n);
  if (total <= 0n || units.some((u) => u <= 0n)) {
    throw new RangeError('Every output needs a weight above zero');
  }
  const steps = 10_000n; // 100 % in steps of 0.01 %
  const shares = units.map((u, index) => ({
    index,
    floor: (u * steps) / total,
    remainder: (u * steps) % total,
  }));
  let missing = steps - shares.reduce((sum, s) => sum + s.floor, 0n);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const share of byRemainder) {
    if (missing === 0n) break;
    share.floor += 1n;
    missing -= 1n;
  }
  return shares.map((s) => formatFixed({ units: s.floor, scale: RATIO_DECIMALS }, RATIO_DECIMALS));
}

export interface AllocationRatios {
  /** Per output, in input order, each with two decimals. */
  ratios: string[];
  /** True when the version states its own ratios rather than the weight shares. */
  overridden: boolean;
}

/**
 * The ratios a valid version allocates its cost by: its overriding ratios when it states
 * them, else the outputs' shares of expected output weight.
 */
export function allocationRatios(
  outputs: readonly BomOutputInput[],
  outputWeights: readonly ExactDecimal[],
): AllocationRatios {
  if (outputs.length > 0 && outputs.every((line) => hasText(line.allocationRatio))) {
    return {
      ratios: outputs.map((line) => formatFixed(decimal(line.allocationRatio ?? ''), 2)),
      overridden: true,
    };
  }
  return { ratios: defaultRatios(outputWeights), overridden: false };
}

/**
 * What the ratios the outputs state add up to, two decimals, so a person overriding them sees
 * how far from 100 they are. Null when no output states one, or one is not a decimal.
 */
export function statedRatioTotal(outputs: readonly BomOutputInput[]): string | null {
  const stated = outputs.filter((line) => hasText(line.allocationRatio));
  if (stated.length === 0) return null;
  let total = ZERO;
  for (const line of stated) {
    const value = parseDecimal(line.allocationRatio ?? '');
    if (!value) return null;
    total = add(total, value);
  }
  return formatFixed(total, RATIO_DECIMALS);
}

/** A weight in kg as the API spells it: exactly three decimals. */
export function formatKg(value: ExactDecimal): string {
  return formatFixed(value, WEIGHT_DECIMALS);
}

/** A quantity in its shortest exact spelling: "5.000" → "5". */
export function normaliseQuantity(text: string): string {
  return formatMinimal(decimal(text));
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}

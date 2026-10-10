// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The one inspection model (ADR-0007 decision 1; ADR-0014 decision 2; ADR-0025): what a receiver
 * records about one line of a delivery, judged against the item's receiving tolerances. Goods
 * receipts from suppliers (#11) use it, and transfer receipts at a branch will use it unchanged:
 * both record the same facts, and two models would drift.
 *
 * Pure: quantities arrive already converted to the item's base unit (ADR-0005), as exact decimal
 * strings (ADR-0019); temperatures are degrees Celsius. The function reports findings; it decides
 * nothing. Whoever calls it decides that a line with a finding needs a reason and someone else's
 * approval.
 *
 * Nothing here is a parameter property or an enum: the console's public demo may import it
 * (ADR-0021).
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
  type ExactDecimal,
} from '../../quantity/domain/exact-decimal';
import { compareDates, isIsoDate } from '../../time/domain/business-date';

/** The state the goods arrived in, as the receiver judges it at the dock. */
export const CONDITIONS = ['good', 'damaged'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** A receiving temperature has at most one decimal (a probe reads 3.8 °C). */
export const TEMPERATURE_MAX_DECIMALS = 1;
/** Between deep frozen and a hot day at the dock; anything outside is a typing mistake. */
export const TEMPERATURE_MIN = '-60';
export const TEMPERATURE_MAX = '60';
/** A variance limit is a percentage with at most two decimals, from 0 to 100. */
export const VARIANCE_MAX_DECIMALS = 2;
/** A variance shown on a finding is rounded once, to two decimals. */
export const VARIANCE_SHOWN_DECIMALS = 2;

/**
 * An item's receiving tolerances (ADR-0007 decision 2): configuration, never constants. Null
 * means no check: an item without a temperature limit is never "too warm".
 */
export interface ReceivingTolerances {
  /** The largest difference between counted and expected quantity, in percent: "2". */
  maxVariancePercent: string | null;
  /** The warmest the goods may arrive, in °C: "4". */
  maxTemperature: string | null;
}

export type ToleranceProblem =
  | 'VARIANCE_NOT_A_NUMBER'
  | 'VARIANCE_OUT_OF_RANGE'
  | 'VARIANCE_TOO_PRECISE'
  | 'TEMPERATURE_NOT_A_NUMBER'
  | 'TEMPERATURE_OUT_OF_RANGE'
  | 'TEMPERATURE_TOO_PRECISE';

/** What is wrong with a set of tolerances an admin wants to save, or null. */
export function toleranceProblem(tolerances: ReceivingTolerances): ToleranceProblem | null {
  if (tolerances.maxVariancePercent !== null) {
    const value = parseDecimal(tolerances.maxVariancePercent);
    if (!value) return 'VARIANCE_NOT_A_NUMBER';
    if (sign(value) < 0 || compare(value, HUNDRED) > 0) return 'VARIANCE_OUT_OF_RANGE';
    if (decimalPlaces(value) > VARIANCE_MAX_DECIMALS) return 'VARIANCE_TOO_PRECISE';
  }
  if (tolerances.maxTemperature !== null) {
    const problem = temperatureProblem(tolerances.maxTemperature);
    if (problem) return problem;
  }
  return null;
}

/** What is wrong with a temperature reading or limit, or null. */
export function temperatureProblem(
  text: string,
): 'TEMPERATURE_NOT_A_NUMBER' | 'TEMPERATURE_OUT_OF_RANGE' | 'TEMPERATURE_TOO_PRECISE' | null {
  const value = parseDecimal(text);
  if (!value) return 'TEMPERATURE_NOT_A_NUMBER';
  if (compare(value, exact(TEMPERATURE_MIN)) < 0 || compare(value, exact(TEMPERATURE_MAX)) > 0) {
    return 'TEMPERATURE_OUT_OF_RANGE';
  }
  if (decimalPlaces(value) > TEMPERATURE_MAX_DECIMALS || integerDigits(value) > 2) {
    return 'TEMPERATURE_TOO_PRECISE';
  }
  return null;
}

/** Tolerances as stored and returned: the shortest exact spelling ("2", "4.5"), or null. */
export function normaliseTolerances(tolerances: ReceivingTolerances): ReceivingTolerances {
  return {
    maxVariancePercent:
      tolerances.maxVariancePercent === null ? null : minimal(tolerances.maxVariancePercent),
    maxTemperature: tolerances.maxTemperature === null ? null : minimal(tolerances.maxTemperature),
  };
}

/** One line as the receiver records it, quantities already in the base unit. */
export interface InspectionInput {
  /** What this delivery was expected to bring: what is still outstanding on the order line. */
  expectedQuantity: string;
  /** What the receiver counted or weighed, whatever is accepted or rejected afterwards. */
  countedQuantity: string;
  /** °C at the dock, or null when nothing was measured. */
  temperature: string | null;
  condition: Condition;
  tolerances: ReceivingTolerances;
  /**
   * The expiry the ERP computes: the receipt date plus the item's shelf life for a supplier
   * delivery (ADR-0006).
   */
  computedExpiry: string;
  /** The expiry printed by the supplier, when there is one (ADR-0014). */
  supplierExpiry: string | null;
}

export type InspectionInputProblem = 'TEMPERATURE_REQUIRED';

/**
 * What the receiver must still record before the line can be inspected, or null. An item with
 * a temperature limit is measured at the dock: an unmeasured delivery cannot be shown to be cold
 * enough, so it is not judged "probably fine".
 */
export function inspectionInputProblem(
  input: Pick<InspectionInput, 'temperature' | 'tolerances'>,
): InspectionInputProblem | null {
  if (input.tolerances.maxTemperature !== null && input.temperature === null) {
    return 'TEMPERATURE_REQUIRED';
  }
  return null;
}

/** Something about the line outside tolerance. Each one needs a reason and an approval. */
export type Finding =
  | {
      code: 'over_quantity' | 'under_quantity';
      /** Counted against expected, signed, two decimals; null when nothing was expected. */
      variancePercent: string | null;
      limitPercent: string;
    }
  | { code: 'too_warm'; temperature: string; limit: string }
  | { code: 'damaged' }
  | { code: 'short_dated'; supplierExpiry: string; computedExpiry: string };

export type FindingCode = Finding['code'];

/** The order findings are listed in, so the same line always reads the same way. */
export const FINDING_CODES: readonly FindingCode[] = [
  'over_quantity',
  'under_quantity',
  'too_warm',
  'damaged',
  'short_dated',
];

/**
 * The findings for one line, in a fixed order, or none:
 *
 * - **over / under quantity** when the counted quantity differs from the expected one by more
 *   than the item's variance limit, compared exactly (2% of 240 kg is 4.8 kg: 235.2 kg is within,
 *   235.199 kg is not). Anything counted when nothing was expected is over. No limit, no check.
 * - **too warm** when the temperature is above the item's limit. No limit, no check.
 * - **damaged** when the receiver says so.
 * - **short dated** when the supplier's expiry is earlier than the computed one (ADR-0014): the
 *   lot will take the supplier's date, and that must be a decision, not an accident.
 */
export function inspect(input: InspectionInput): Finding[] {
  const findings: Finding[] = [];

  const limit = input.tolerances.maxVariancePercent;
  if (limit !== null) {
    const expected = exact(input.expectedQuantity);
    const counted = exact(input.countedQuantity);
    const difference = add(counted, negate(expected));
    const allowed = percentOf(expected, exact(limit));
    const outside =
      sign(expected) === 0 ? sign(counted) > 0 : compare(abs(difference), allowed) > 0;
    if (outside) {
      findings.push({
        code: sign(difference) > 0 ? 'over_quantity' : 'under_quantity',
        variancePercent:
          sign(expected) === 0
            ? null
            : formatFixed(
                divideRounded(multiply(difference, HUNDRED), expected, VARIANCE_SHOWN_DECIMALS),
                VARIANCE_SHOWN_DECIMALS,
              ),
        limitPercent: minimal(limit),
      });
    }
  }

  const maxTemperature = input.tolerances.maxTemperature;
  if (maxTemperature !== null && input.temperature !== null) {
    if (compare(exact(input.temperature), exact(maxTemperature)) > 0) {
      findings.push({
        code: 'too_warm',
        temperature: minimal(input.temperature),
        limit: minimal(maxTemperature),
      });
    }
  }

  if (input.condition === 'damaged') findings.push({ code: 'damaged' });

  if (
    input.supplierExpiry !== null &&
    isIsoDate(input.supplierExpiry) &&
    compareDates(input.supplierExpiry, input.computedExpiry) < 0
  ) {
    findings.push({
      code: 'short_dated',
      supplierExpiry: input.supplierExpiry,
      computedExpiry: input.computedExpiry,
    });
  }

  return findings;
}

const HUNDRED: ExactDecimal = { units: 100n, scale: 0 };

/** `percent` percent of `value`, exactly: dividing by a hundred never needs rounding. */
function percentOf(value: ExactDecimal, percent: ExactDecimal): ExactDecimal {
  const product = multiply(value, percent);
  return { units: product.units, scale: product.scale + 2 };
}

function compare(a: ExactDecimal, b: ExactDecimal): number {
  return sign(add(a, negate(b)));
}

function abs(value: ExactDecimal): ExactDecimal {
  return sign(value) < 0 ? negate(value) : value;
}

function exact(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new RangeError(`Not a plain decimal: ${text}`);
  return value;
}

function minimal(text: string): string {
  return formatMinimal(exact(text));
}

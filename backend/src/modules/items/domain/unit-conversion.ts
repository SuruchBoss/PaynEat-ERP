// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Converting a quantity in a purchase unit to the item's base unit (ADR-0005, and the
 * rounding rule of ADR-0019). Pure: the items service, the console's preview and, later,
 * receiving all use this one definition.
 */
import {
  decimalPlaces,
  formatFixed,
  formatMinimal,
  integerDigits,
  multiply,
  parseDecimal,
  roundHalfAwayFromZero,
  sign,
} from '../../../core/quantity/domain/exact-decimal';

/** A factor is stored as NUMERIC(18,6): at most 6 decimals and 12 digits before them. */
export const FACTOR_MAX_DECIMALS = 6;
export const FACTOR_MAX_INTEGER_DIGITS = 12;

export type FactorProblem = 'NOT_A_NUMBER' | 'NOT_POSITIVE' | 'TOO_MANY_DECIMALS' | 'TOO_LARGE';

/**
 * What is wrong with a conversion factor (how many base units one purchase unit holds),
 * or null. Zero or negative is refused outright: a case "holding" 0 kg would turn a
 * delivery into nothing, and a negative one into a withdrawal.
 */
export function factorProblem(factor: string): FactorProblem | null {
  const value = parseDecimal(factor);
  if (!value) return 'NOT_A_NUMBER';
  if (sign(value) <= 0) return 'NOT_POSITIVE';
  if (decimalPlaces(value) > FACTOR_MAX_DECIMALS) return 'TOO_MANY_DECIMALS';
  if (integerDigits(value) > FACTOR_MAX_INTEGER_DIGITS) return 'TOO_LARGE';
  return null;
}

/** The factor as the API returns it: "10", "22.5", "0.0125". Assumes a valid factor. */
export function normaliseFactor(factor: string): string {
  const value = parseDecimal(factor);
  if (!value) throw new ConversionError('NOT_A_NUMBER', `"${factor}" is not a decimal number`);
  return formatMinimal(value);
}

export type ConversionProblem = FactorProblem | 'QUANTITY_NOT_A_NUMBER' | 'QUANTITY_TOO_PRECISE';

export class ConversionError extends Error {
  constructor(
    readonly problem: ConversionProblem,
    message: string,
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}

export interface ConversionInput {
  /** The quantity in the purchase unit, as a decimal string; may be negative (a return). */
  quantity: string;
  /** Decimals the purchase unit allows: 0 for a case, so "2.5 cases" is refused. */
  purchaseUnitDecimals: number;
  /** Base units per purchase unit. */
  factor: string;
  /** Decimals the base unit keeps: 3 for kg (grams), 0 for pieces. */
  baseUnitDecimals: number;
}

/**
 * `quantity × factor`, computed exactly and rounded once, half away from zero, to the
 * base unit's decimals. Returned with exactly those decimals: 3 cases of 10 kg is
 * "30.000"; 3 packs of 2.5 pieces is "8".
 */
export function toBaseQuantity(input: ConversionInput): string {
  const quantity = parseDecimal(input.quantity);
  if (!quantity) {
    throw new ConversionError(
      'QUANTITY_NOT_A_NUMBER',
      `"${input.quantity}" is not a decimal number`,
    );
  }
  if (decimalPlaces(quantity) > input.purchaseUnitDecimals) {
    throw new ConversionError(
      'QUANTITY_TOO_PRECISE',
      `${input.quantity} has more than the ${input.purchaseUnitDecimals} decimals this unit allows`,
    );
  }
  const problem = factorProblem(input.factor);
  if (problem) {
    throw new ConversionError(problem, `"${input.factor}" is not a valid conversion factor`);
  }

  const exact = multiply(quantity, parseDecimal(input.factor)!);
  return formatFixed(roundHalfAwayFromZero(exact, input.baseUnitDecimals), input.baseUnitDecimals);
}

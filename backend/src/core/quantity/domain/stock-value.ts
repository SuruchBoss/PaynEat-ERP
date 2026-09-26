// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Quantities, costs and values as the API shows them (#7, ADR-0004, ADR-0019): exact, never
 * through a binary floating-point number, and never rounded after the fact, so values always
 * add up to their total.
 */
import {
  add,
  formatFixed,
  formatMinimal,
  multiply,
  parseDecimal,
  ZERO,
  type ExactDecimal,
} from './exact-decimal';

/** Quantity × unit cost, exact: 21.600 kg at 72.5 is "1566". */
export function stockValue(quantity: string, unitCost: string): string {
  return formatMinimal(multiply(decimal(quantity), decimal(unitCost)));
}

export function sumValues(values: readonly string[]): string {
  return formatMinimal(values.reduce<ExactDecimal>((total, v) => add(total, decimal(v)), ZERO));
}

/** A quantity with exactly the unit's decimals: "21.600" kg, "12" pieces. */
export function formatQuantity(quantity: string, decimals: number): string {
  return formatFixed(decimal(quantity), decimals);
}

/** The shortest exact spelling: "72.500000" → "72.5". */
export function normaliseDecimal(text: string): string {
  return formatMinimal(decimal(text));
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}

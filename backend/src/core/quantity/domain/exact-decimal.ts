// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Exact decimal arithmetic for quantities, conversion factors and (later) costs
 * (ADR-0019). A value is an integer count of `10^-scale` steps held in a bigint, so
 * 0.1 + 0.2 is 0.3 and 12 birds of 1.8 kg are exactly 21.6 kg — binary floating point
 * gets both wrong, and a ledger that must balance to the gram cannot afford that.
 *
 * Over the API and in PostgreSQL (NUMERIC) the same values travel as decimal strings.
 */

/** `units × 10^-scale`, e.g. 21.600 is `{ units: 21600n, scale: 3 }`. */
export interface ExactDecimal {
  readonly units: bigint;
  readonly scale: number;
}

/** Plain decimal notation only: an optional minus, digits, an optional fraction. */
const PLAIN_DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** The value `text` spells, or null when it is not plain decimal notation. */
export function parseDecimal(text: string): ExactDecimal | null {
  const match = PLAIN_DECIMAL.exec(text);
  if (!match) return null;
  const [, minus, whole, fraction = ''] = match;
  const units = BigInt(whole + fraction);
  return { units: minus ? -units : units, scale: fraction.length };
}

/** Decimal places the value actually needs: 10.500 needs 1, 10.000 needs 0. */
export function decimalPlaces(value: ExactDecimal): number {
  let { units, scale } = value;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return scale;
}

/** Digits before the decimal point, ignoring the sign: 1234.5 has 4, 0.5 has 1. */
export function integerDigits(value: ExactDecimal): number {
  const whole = abs(value.units) / 10n ** BigInt(value.scale);
  return whole.toString().length;
}

export function sign(value: ExactDecimal): -1 | 0 | 1 {
  return value.units > 0n ? 1 : value.units < 0n ? -1 : 0;
}

export function multiply(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

/**
 * Rounds to `places` decimals, half away from zero: 0.0125 → 0.013 and -0.0125 → -0.013,
 * exactly as PostgreSQL's `round(numeric, places)` does, so the API and the database
 * never disagree about a rounded quantity.
 */
export function roundHalfAwayFromZero(value: ExactDecimal, places: number): ExactDecimal {
  if (value.scale <= places) {
    return { units: value.units * 10n ** BigInt(places - value.scale), scale: places };
  }
  const divisor = 10n ** BigInt(value.scale - places);
  const magnitude = abs(value.units);
  let rounded = magnitude / divisor;
  if ((magnitude % divisor) * 2n >= divisor) rounded += 1n;
  return { units: value.units < 0n ? -rounded : rounded, scale: places };
}

/** Exactly `places` decimals: `format({ units: 216n, scale: 1 }, 3)` is "21.600". */
export function formatFixed(value: ExactDecimal, places: number): string {
  const { units } = roundHalfAwayFromZero(value, places);
  const digits = abs(units)
    .toString()
    .padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = digits.slice(digits.length - places);
  return `${units < 0n ? '-' : ''}${whole}${places > 0 ? `.${fraction}` : ''}`;
}

/** The shortest exact spelling: 10.000000 → "10", 22.500 → "22.5". */
export function formatMinimal(value: ExactDecimal): string {
  return formatFixed(value, decimalPlaces(value));
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

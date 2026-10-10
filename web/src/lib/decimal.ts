// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Exact arithmetic on the decimal strings the API sends (ADR-0019), for the few places a screen
 * fills in a figure for the person as they type: what is left of a dispatched quantity once the
 * accepted and returned parts are taken away (#14). The API checks the result again; this never
 * rounds, so what the screen proposes is what the API would compute.
 */
const PLAIN = /^-?\d+(\.\d+)?$/;

interface Exact {
  units: bigint;
  scale: number;
}

function parse(text: string): Exact | null {
  const trimmed = text.trim();
  if (!PLAIN.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.replace('-', '').split('.');
  const units = BigInt(whole + fraction) * (trimmed.startsWith('-') ? -1n : 1n);
  return { units, scale: fraction.length };
}

function rescale(value: Exact, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function format(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && text !== '0' ? `-${text}` : text;
}

/**
 * `from` less every one of `parts`, exactly, in its shortest spelling; null when any of them is
 * not a plain decimal (an empty box counts as zero).
 */
export function subtract(from: string, ...parts: string[]): string | null {
  const values = [from, ...parts].map((p) =>
    p.trim() === '' ? { units: 0n, scale: 0 } : parse(p),
  );
  if (values.some((v) => v === null)) return null;
  const exact = values as Exact[];
  const scale = Math.max(...exact.map((v) => v.scale));
  const [first, ...rest] = exact.map((v) => rescale(v, scale));
  return format(
    rest.reduce((sum, v) => sum - v, first),
    scale,
  );
}

/** -1, 0 or 1 as `a` is less than, equal to or more than `b`; null when either is not a decimal. */
export function compare(a: string, b: string): -1 | 0 | 1 | null {
  const difference = subtract(a, b);
  if (difference === null) return null;
  return difference.startsWith('-') ? -1 : difference === '0' ? 0 : 1;
}

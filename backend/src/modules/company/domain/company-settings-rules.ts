// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules of the company's settings (#10). Pure: the service checks a change with them before
 * saving it.
 */
import {
  decimalPlaces,
  integerDigits,
  parseDecimal,
  sign,
} from '../../../core/quantity/domain/exact-decimal';

export type ThresholdProblem =
  'THRESHOLD_NOT_A_NUMBER' | 'THRESHOLD_NEGATIVE' | 'THRESHOLD_TOO_PRECISE' | 'THRESHOLD_TOO_LARGE';

/**
 * The purchase approval threshold is money: zero or more, at most two decimals, stored as
 * NUMERIC(18,2). Zero sends every purchase order to an approver (ADR-0024).
 */
export function thresholdProblem(text: string): ThresholdProblem | null {
  const value = parseDecimal(text);
  if (!value) return 'THRESHOLD_NOT_A_NUMBER';
  if (sign(value) < 0) return 'THRESHOLD_NEGATIVE';
  if (decimalPlaces(value) > 2) return 'THRESHOLD_TOO_PRECISE';
  if (integerDigits(value) > 16) return 'THRESHOLD_TOO_LARGE';
  return null;
}

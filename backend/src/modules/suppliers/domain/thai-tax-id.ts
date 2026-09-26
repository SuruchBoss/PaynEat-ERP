// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The Thai tax identification number (เลขประจำตัวผู้เสียภาษีอากร): 13 digits, the last a
 * check digit over the first twelve. Companies and people share the scheme. Checked so a
 * mistyped number is caught at entry rather than on a supplier's tax invoice.
 */
export type TaxIdProblem = 'NOT_13_DIGITS' | 'CHECK_DIGIT';

/** Digits only: people type the number with spaces or dashes (0-1055-12345-67-8). */
export function normaliseTaxId(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function thaiTaxIdCheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (13 - i);
  return (11 - (sum % 11)) % 10;
}

/** What is wrong with a normalised tax id, or null. */
export function thaiTaxIdProblem(taxId: string): TaxIdProblem | null {
  if (!/^\d{13}$/.test(taxId)) return 'NOT_13_DIGITS';
  return thaiTaxIdCheckDigit(taxId.slice(0, 12)) === Number(taxId[12]) ? null : 'CHECK_DIGIT';
}

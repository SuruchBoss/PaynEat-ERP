// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { normaliseTaxId, thaiTaxIdCheckDigit, thaiTaxIdProblem } from './thai-tax-id';

describe('Thai tax identification numbers', () => {
  it('computes the check digit over the first twelve digits', () => {
    // Worked by hand: 1×13 + 2×12 + … + 2×2 = 352; 352 mod 11 = 0; (11 − 0) mod 10 = 1.
    expect(thaiTaxIdCheckDigit('123456789012')).toBe(1);
    expect(thaiTaxIdCheckDigit('000000000000')).toBe(1);
  });

  it('accepts a number whose check digit matches', () => {
    expect(thaiTaxIdProblem('1234567890121')).toBeNull();
    expect(thaiTaxIdProblem('0000000000001')).toBeNull();
  });

  it('catches a mistyped digit and a swapped pair', () => {
    expect(thaiTaxIdProblem('1234567890122')).toBe('CHECK_DIGIT');
    expect(thaiTaxIdProblem('2134567890121')).toBe('CHECK_DIGIT');
  });

  it.each(['123456789012', '12345678901234', '12345678901A1', ''])(
    'refuses %j, which is not 13 digits',
    (taxId) => {
      expect(thaiTaxIdProblem(taxId)).toBe('NOT_13_DIGITS');
    },
  );

  it('takes the number as people write it', () => {
    expect(normaliseTaxId(' 1-2345-67890-12-1 ')).toBe('1234567890121');
  });
});

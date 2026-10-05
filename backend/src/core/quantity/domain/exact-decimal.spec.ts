// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

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
  roundHalfAwayFromZero,
  sign,
  ZERO,
  type ExactDecimal,
} from './exact-decimal';

const d = (text: string): ExactDecimal => {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: ${text}`);
  return value;
};

describe('exact decimals', () => {
  it.each([
    ['21.6', { units: 216n, scale: 1 }],
    ['10', { units: 10n, scale: 0 }],
    ['-0.25', { units: -25n, scale: 2 }],
    ['0.000001', { units: 1n, scale: 6 }],
    ['007.50', { units: 750n, scale: 2 }],
  ])('parses %s', (text, expected) => {
    expect(parseDecimal(text)).toEqual(expected);
  });

  it.each(['', '1e3', '+1', '.5', '5.', '1,5', ' 1', '1 ', 'NaN', 'Infinity', '0x10', '--1'])(
    'refuses %j, which is not plain decimal notation',
    (text) => {
      expect(parseDecimal(text)).toBeNull();
    },
  );

  it('is exact where binary floating point is not', () => {
    expect(0.1 * 3).not.toBe(0.3);
    expect(formatMinimal(multiply(d('0.1'), d('3')))).toBe('0.3');
    // 12 birds at 1.8 kg each.
    expect(formatMinimal(multiply(d('12'), d('1.8')))).toBe('21.6');
  });

  it('counts the decimals a value needs and the digits before the point', () => {
    expect(decimalPlaces(d('10.500'))).toBe(1);
    expect(decimalPlaces(d('10.000'))).toBe(0);
    expect(decimalPlaces(d('0.000001'))).toBe(6);
    expect(integerDigits(d('1234.5'))).toBe(4);
    expect(integerDigits(d('0.5'))).toBe(1);
    expect(integerDigits(d('-999999999999.5'))).toBe(12);
  });

  it('knows the sign', () => {
    expect([sign(d('-0.001')), sign(d('0.000')), sign(d('3'))]).toEqual([-1, 0, 1]);
  });

  describe('rounding half away from zero', () => {
    it.each([
      ['0.0125', 3, '0.013'],
      ['-0.0125', 3, '-0.013'],
      ['0.0124999', 3, '0.012'],
      ['2.5', 0, '3'],
      ['-2.5', 0, '-3'],
      ['2.4999', 0, '2'],
      ['0.0005', 3, '0.001'],
      ['0.0004', 3, '0.000'],
      ['7.5', 3, '7.500'],
    ])('%s to %i places is %s', (text, places, expected) => {
      expect(formatFixed(roundHalfAwayFromZero(d(text), places), places)).toBe(expected);
    });
  });

  it('formats with fixed or minimal decimals', () => {
    expect(formatFixed(d('21.6'), 3)).toBe('21.600');
    expect(formatFixed(d('-0.5'), 0)).toBe('-1');
    expect(formatMinimal(d('10.000000'))).toBe('10');
    expect(formatMinimal(d('0.050'))).toBe('0.05');
    expect(formatMinimal(d('-0'))).toBe('0');
  });

  it('adds exactly across scales, and negates', () => {
    expect(formatMinimal(add(d('0.1'), d('0.2')))).toBe('0.3');
    expect(formatFixed(add(d('21.600'), d('-21.6')), 3)).toBe('0.000');
    expect(formatMinimal(add(d('1846.8'), d('0.000001')))).toBe('1846.800001');
    expect(formatMinimal(add(ZERO, d('-3')))).toBe('-3');
    expect(formatMinimal(negate(d('12.5')))).toBe('-12.5');
    expect(formatMinimal(negate(negate(d('-0.013'))))).toBe('-0.013');
  });

  it.each([
    ['100', '3', 2, '33.33'],
    ['2', '3', 2, '0.67'],
    ['1', '8', 2, '0.13'],
    ['-1', '8', 2, '-0.13'],
    ['1', '-8', 2, '-0.13'],
    ['1284', '20', 6, '64.200000'],
    ['1373.88', '20', 6, '68.694000'],
    ['850', '25', 6, '34.000000'],
    ['0.000001', '3', 6, '0.000000'],
    ['0.000002', '3', 6, '0.000001'],
    ['10', '0.25', 2, '40.00'],
  ])('divides %s by %s, rounded once to %i places half away from zero: %s', (a, b, p, out) => {
    expect(formatFixed(divideRounded(d(a), d(b), p), p)).toBe(out);
  });

  it('refuses to divide by zero', () => {
    expect(() => divideRounded(d('1'), d('0.000'), 2)).toThrow(RangeError);
  });
});

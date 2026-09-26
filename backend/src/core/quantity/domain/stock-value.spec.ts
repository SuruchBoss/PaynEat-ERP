// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { formatQuantity, normaliseDecimal, stockValue, sumValues } from './stock-value';

describe('stock values', () => {
  it('values stock exactly, and totals add up', () => {
    expect(stockValue('21.600', '72.500000')).toBe('1566');
    expect(stockValue('0.013', '32.5')).toBe('0.4225');
    expect(stockValue('-1.8', '72.5')).toBe('-130.5');
    expect(sumValues(['1566', '0.4225', '-130.5'])).toBe('1435.9225');
    expect(sumValues([])).toBe('0');
  });

  it("shows a quantity with the unit's decimals, and a cost as short as it is exact", () => {
    expect(formatQuantity('21.6', 3)).toBe('21.600');
    expect(formatQuantity('12', 0)).toBe('12');
    expect(formatQuantity('-0', 3)).toBe('0.000');
    expect(normaliseDecimal('72.500000')).toBe('72.5');
    expect(normaliseDecimal('0.000000')).toBe('0');
    expect(normaliseDecimal('100')).toBe('100');
  });
});

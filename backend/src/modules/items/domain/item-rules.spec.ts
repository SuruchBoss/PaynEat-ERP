// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { normalisePurchaseUnits, purchaseUnitIssues } from './item-rules';

const UNITS = new Set(['kg', 'case', 'bag', 'sack', 'piece']);

describe('purchase unit rules', () => {
  it('accepts known units other than the base unit, each once, with positive factors', () => {
    expect(
      purchaseUnitIssues(
        'kg',
        [
          { unitCode: 'case', factor: '10' },
          { unitCode: 'sack', factor: '22.5' },
        ],
        UNITS,
      ),
    ).toEqual([]);
    expect(purchaseUnitIssues('kg', [], UNITS)).toEqual([]);
  });

  it('reports every problem at once, with its position', () => {
    expect(
      purchaseUnitIssues(
        'kg',
        [
          { unitCode: 'kg', factor: '1' },
          { unitCode: 'case', factor: '0' },
          { unitCode: 'crate', factor: '5' },
          { unitCode: 'case', factor: '-3' },
          { unitCode: 'bag', factor: '1.0000001' },
        ],
        UNITS,
      ),
    ).toEqual([
      { index: 0, unitCode: 'kg', problem: 'SAME_AS_BASE_UNIT' },
      { index: 1, unitCode: 'case', problem: 'NOT_POSITIVE' },
      { index: 2, unitCode: 'crate', problem: 'UNKNOWN_UNIT' },
      { index: 3, unitCode: 'case', problem: 'DUPLICATE' },
      { index: 3, unitCode: 'case', problem: 'NOT_POSITIVE' },
      { index: 4, unitCode: 'bag', problem: 'TOO_MANY_DECIMALS' },
    ]);
  });

  it('stores factors in their shortest form, ordered by unit', () => {
    expect(
      normalisePurchaseUnits([
        { unitCode: 'sack', factor: '22.500' },
        { unitCode: 'case', factor: '10.000000' },
      ]),
    ).toEqual([
      { unitCode: 'case', factor: '10' },
      { unitCode: 'sack', factor: '22.5' },
    ]);
  });
});

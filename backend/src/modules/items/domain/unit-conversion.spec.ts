// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  ConversionError,
  factorProblem,
  normaliseFactor,
  toBaseQuantity,
  type ConversionInput,
} from './unit-conversion';

const KG = 3;
const PIECE = 0;
const CASE = 0;

const convert = (input: Partial<ConversionInput> & Pick<ConversionInput, 'quantity' | 'factor'>) =>
  toBaseQuantity({ purchaseUnitDecimals: CASE, baseUnitDecimals: KG, ...input });

const problemOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (error instanceof ConversionError) return error.problem;
    throw error;
  }
};

describe('conversion factors', () => {
  it.each(['10', '22.5', '0.000001', '999999999999.999999', '48'])('accepts %s', (factor) => {
    expect(factorProblem(factor)).toBeNull();
  });

  it.each([
    ['0', 'NOT_POSITIVE'],
    ['0.000000', 'NOT_POSITIVE'],
    ['-10', 'NOT_POSITIVE'],
    ['-0.5', 'NOT_POSITIVE'],
    ['0.0000001', 'TOO_MANY_DECIMALS'],
    ['1000000000000', 'TOO_LARGE'],
    ['ten', 'NOT_A_NUMBER'],
    ['1e1', 'NOT_A_NUMBER'],
    ['', 'NOT_A_NUMBER'],
  ])('refuses %j (%s)', (factor, problem) => {
    expect(factorProblem(factor)).toBe(problem);
  });

  it('allows trailing zeros beyond six decimals, since they change nothing', () => {
    expect(factorProblem('10.0000000')).toBeNull();
    expect(normaliseFactor('10.0000000')).toBe('10');
  });

  it('is returned in its shortest exact form', () => {
    expect(normaliseFactor('22.500000')).toBe('22.5');
    expect(normaliseFactor('0.012500')).toBe('0.0125');
  });
});

describe('converting a purchase quantity to the base unit', () => {
  it('multiplies exactly: 3 cases of 10 kg are 30 kg', () => {
    expect(convert({ quantity: '3', factor: '10' })).toBe('30.000');
  });

  it('keeps exactly the base unit decimals', () => {
    // A 22.5 kg sack of flour.
    expect(convert({ quantity: '1', factor: '22.5' })).toBe('22.500');
    // An 18 l tin of oil counted in whole pieces would be 18 pieces.
    expect(convert({ quantity: '1', factor: '18', baseUnitDecimals: PIECE })).toBe('18');
  });

  it('rounds once, half away from zero, to the base unit decimals', () => {
    // A 12.5 g pack in kg: 0.0125 → 0.013.
    expect(convert({ quantity: '1', factor: '0.0125' })).toBe('0.013');
    // A return of the same pack rounds away from zero too, never towards it.
    expect(convert({ quantity: '-1', factor: '0.0125' })).toBe('-0.013');
    // Below half rounds down: 7 × 0.333333 = 2.333331 → 2.333.
    expect(convert({ quantity: '7', factor: '0.333333' })).toBe('2.333');
    // Pieces: 3 packs of 2.5 pieces are 7.5 → 8.
    expect(convert({ quantity: '3', factor: '2.5', baseUnitDecimals: PIECE })).toBe('8');
  });

  it('rounds the exact product, not each step', () => {
    // 3 × 0.3335 = 1.0005 → 1.001; rounding the factor first (0.334 × 3 = 1.002) would not.
    expect(convert({ quantity: '3', factor: '0.3335' })).toBe('1.001');
  });

  it('accepts a fractional quantity where the purchase unit allows one', () => {
    expect(convert({ quantity: '2.5', factor: '1', purchaseUnitDecimals: 3 })).toBe('2.500');
  });

  it('refuses a quantity more precise than its unit: there is no half a case', () => {
    expect(problemOf(() => convert({ quantity: '2.5', factor: '10' }))).toBe(
      'QUANTITY_TOO_PRECISE',
    );
    // Trailing zeros are not precision.
    expect(convert({ quantity: '2.00', factor: '10' })).toBe('20.000');
  });

  it('refuses a zero or negative factor', () => {
    expect(problemOf(() => convert({ quantity: '3', factor: '0' }))).toBe('NOT_POSITIVE');
    expect(problemOf(() => convert({ quantity: '3', factor: '-10' }))).toBe('NOT_POSITIVE');
  });

  it('refuses what is not a number', () => {
    expect(problemOf(() => convert({ quantity: 'three', factor: '10' }))).toBe(
      'QUANTITY_NOT_A_NUMBER',
    );
    expect(problemOf(() => convert({ quantity: '3', factor: '10 kg' }))).toBe('NOT_A_NUMBER');
  });

  it('converts zero to zero', () => {
    expect(convert({ quantity: '0', factor: '10' })).toBe('0.000');
  });
});

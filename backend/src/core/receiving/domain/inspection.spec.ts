// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  inspect,
  inspectionInputProblem,
  normaliseTolerances,
  temperatureProblem,
  toleranceProblem,
  type InspectionInput,
} from './inspection';

/** 240 kg of whole chicken expected, chilled, five days of shelf life from a receipt on 1 Oct. */
const input = (overrides: Partial<InspectionInput> = {}): InspectionInput => ({
  expectedQuantity: '240.000',
  countedQuantity: '240.000',
  temperature: '2.8',
  condition: 'good',
  tolerances: { maxVariancePercent: '2', maxTemperature: '4' },
  computedExpiry: '2026-10-06',
  supplierExpiry: null,
  ...overrides,
});

describe('inspection (ADR-0007, ADR-0014)', () => {
  it('finds nothing when everything is as expected', () => {
    expect(inspect(input())).toEqual([]);
  });

  describe('quantity against the variance limit', () => {
    it('allows exactly the limit either way, and refuses a gram more (2% of 240 kg is 4.8 kg)', () => {
      expect(inspect(input({ countedQuantity: '235.200' }))).toEqual([]);
      expect(inspect(input({ countedQuantity: '244.800' }))).toEqual([]);
      expect(inspect(input({ countedQuantity: '235.199' }))).toEqual([
        { code: 'under_quantity', variancePercent: '-2.00', limitPercent: '2' },
      ]);
      expect(inspect(input({ countedQuantity: '244.801' }))).toEqual([
        { code: 'over_quantity', variancePercent: '2.00', limitPercent: '2' },
      ]);
    });

    it('shows the variance rounded once to two decimals (238.4 of 240 kg is -0.67%)', () => {
      const findings = inspect(
        input({
          countedQuantity: '238.400',
          tolerances: { maxVariancePercent: '0.5', maxTemperature: null },
        }),
      );
      expect(findings).toEqual([
        { code: 'under_quantity', variancePercent: '-0.67', limitPercent: '0.5' },
      ]);
    });

    it('treats anything counted when nothing was expected as over, with no percentage', () => {
      expect(inspect(input({ expectedQuantity: '0.000', countedQuantity: '1.000' }))).toEqual([
        { code: 'over_quantity', variancePercent: null, limitPercent: '2' },
      ]);
    });

    it('a zero limit means it must be exact', () => {
      const exactOnly = { maxVariancePercent: '0', maxTemperature: null };
      expect(inspect(input({ tolerances: exactOnly }))).toEqual([]);
      expect(inspect(input({ countedQuantity: '240.001', tolerances: exactOnly }))[0].code).toBe(
        'over_quantity',
      );
    });

    it('checks nothing without a limit', () => {
      const none = { maxVariancePercent: null, maxTemperature: null };
      expect(inspect(input({ countedQuantity: '1.000', tolerances: none }))).toEqual([]);
    });
  });

  describe('temperature against the limit', () => {
    it('is too warm only above the limit', () => {
      expect(inspect(input({ temperature: '4' }))).toEqual([]);
      expect(inspect(input({ temperature: '4.1' }))).toEqual([
        { code: 'too_warm', temperature: '4.1', limit: '4' },
      ]);
    });

    it('handles frozen goods below zero', () => {
      const frozen = { maxVariancePercent: null, maxTemperature: '-18' };
      expect(inspect(input({ temperature: '-20', tolerances: frozen }))).toEqual([]);
      expect(inspect(input({ temperature: '-12.5', tolerances: frozen }))).toEqual([
        { code: 'too_warm', temperature: '-12.5', limit: '-18' },
      ]);
    });

    it('requires a reading when the item has a limit, and none when it has not', () => {
      expect(inspectionInputProblem(input({ temperature: null }))).toBe('TEMPERATURE_REQUIRED');
      expect(
        inspectionInputProblem(
          input({
            temperature: null,
            tolerances: { maxVariancePercent: '2', maxTemperature: null },
          }),
        ),
      ).toBeNull();
      expect(inspectionInputProblem(input())).toBeNull();
    });
  });

  it('records damage the receiver reports', () => {
    expect(inspect(input({ condition: 'damaged' }))).toEqual([{ code: 'damaged' }]);
  });

  describe('expiry (ADR-0014)', () => {
    it('is short dated when the supplier date is earlier than the computed one', () => {
      expect(inspect(input({ supplierExpiry: '2026-10-05' }))).toEqual([
        { code: 'short_dated', supplierExpiry: '2026-10-05', computedExpiry: '2026-10-06' },
      ]);
    });

    it('is not when the supplier date is the same or later', () => {
      expect(inspect(input({ supplierExpiry: '2026-10-06' }))).toEqual([]);
      expect(inspect(input({ supplierExpiry: '2026-10-09' }))).toEqual([]);
    });
  });

  it('lists several findings in a fixed order', () => {
    const findings = inspect(
      input({
        countedQuantity: '200.000',
        temperature: '7.2',
        condition: 'damaged',
        supplierExpiry: '2026-10-04',
      }),
    );
    expect(findings.map((f) => f.code)).toEqual([
      'under_quantity',
      'too_warm',
      'damaged',
      'short_dated',
    ]);
  });

  describe('tolerances an admin saves', () => {
    it('accepts none, either or both', () => {
      expect(toleranceProblem({ maxVariancePercent: null, maxTemperature: null })).toBeNull();
      expect(toleranceProblem({ maxVariancePercent: '2.5', maxTemperature: '-18' })).toBeNull();
      expect(toleranceProblem({ maxVariancePercent: '0', maxTemperature: '4' })).toBeNull();
    });

    it('refuses what is not a sensible limit', () => {
      expect(toleranceProblem({ maxVariancePercent: 'two', maxTemperature: null })).toBe(
        'VARIANCE_NOT_A_NUMBER',
      );
      expect(toleranceProblem({ maxVariancePercent: '-1', maxTemperature: null })).toBe(
        'VARIANCE_OUT_OF_RANGE',
      );
      expect(toleranceProblem({ maxVariancePercent: '100.01', maxTemperature: null })).toBe(
        'VARIANCE_OUT_OF_RANGE',
      );
      expect(toleranceProblem({ maxVariancePercent: '1.234', maxTemperature: null })).toBe(
        'VARIANCE_TOO_PRECISE',
      );
      expect(toleranceProblem({ maxVariancePercent: null, maxTemperature: '61' })).toBe(
        'TEMPERATURE_OUT_OF_RANGE',
      );
      expect(toleranceProblem({ maxVariancePercent: null, maxTemperature: '3.25' })).toBe(
        'TEMPERATURE_TOO_PRECISE',
      );
    });

    it('reads a temperature the way a probe shows it', () => {
      expect(temperatureProblem('-60')).toBeNull();
      expect(temperatureProblem('60')).toBeNull();
      expect(temperatureProblem('3.8')).toBeNull();
      expect(temperatureProblem('-60.1')).toBe('TEMPERATURE_OUT_OF_RANGE');
      expect(temperatureProblem('4°')).toBe('TEMPERATURE_NOT_A_NUMBER');
    });

    it('stores the shortest spelling', () => {
      expect(normaliseTolerances({ maxVariancePercent: '2.00', maxTemperature: '4.0' })).toEqual({
        maxVariancePercent: '2',
        maxTemperature: '4',
      });
      expect(normaliseTolerances({ maxVariancePercent: null, maxTemperature: null })).toEqual({
        maxVariancePercent: null,
        maxTemperature: null,
      });
    });
  });
});

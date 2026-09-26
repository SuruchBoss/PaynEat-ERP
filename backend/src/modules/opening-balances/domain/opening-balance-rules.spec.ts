// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  lineProblem,
  locationProblem,
  postingRefusal,
  type LineInput,
  type PostingCandidate,
} from './opening-balance-rules';

const kgVariable = { variableWeight: true, baseUnitDecimals: 3 };
const piece = { variableWeight: false, baseUnitDecimals: 0 };
const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  quantity: '21.6',
  secondaryQuantity: '12',
  unitCost: '72.5',
  expiryDate: '2026-09-28',
  ...overrides,
});

describe('opening-balance rules', () => {
  describe('a line', () => {
    it('accepts a weighed line with its piece count, and a counted line without one', () => {
      expect(lineProblem(line(), kgVariable)).toBeNull();
      expect(lineProblem(line({ secondaryQuantity: null }), kgVariable)).toBeNull();
      expect(lineProblem(line({ quantity: '40', secondaryQuantity: null }), piece)).toBeNull();
      expect(lineProblem(line({ unitCost: '0' }), kgVariable)).toBeNull();
    });

    it.each([
      ['abc', 'QUANTITY_NOT_A_NUMBER'],
      ['1e3', 'QUANTITY_NOT_A_NUMBER'],
      ['0', 'QUANTITY_NOT_POSITIVE'],
      ['-1', 'QUANTITY_NOT_POSITIVE'],
      ['1.0001', 'QUANTITY_TOO_PRECISE'],
      ['1000000000000000', 'QUANTITY_TOO_LARGE'],
    ])('refuses the quantity %s', (quantity, problem) => {
      expect(lineProblem(line({ quantity }), kgVariable)).toBe(problem);
    });

    it('keeps a counted unit to whole pieces', () => {
      expect(lineProblem(line({ quantity: '2.5', secondaryQuantity: null }), piece)).toBe(
        'QUANTITY_TOO_PRECISE',
      );
      expect(lineProblem(line({ quantity: '2.000', secondaryQuantity: null }), piece)).toBeNull();
    });

    it('records a piece count only for variable-weight items, as a whole positive number', () => {
      expect(lineProblem(line({ quantity: '4' }), piece)).toBe('SECONDARY_QUANTITY_NOT_ALLOWED');
      for (const count of ['0', '-1', '1.5', 'x']) {
        expect(lineProblem(line({ secondaryQuantity: count }), kgVariable)).toBe(
          'SECONDARY_QUANTITY_INVALID',
        );
      }
    });

    it.each([
      ['free', 'UNIT_COST_NOT_A_NUMBER'],
      ['-0.01', 'UNIT_COST_NEGATIVE'],
      ['1.0000001', 'UNIT_COST_TOO_PRECISE'],
      ['1000000000000', 'UNIT_COST_TOO_LARGE'],
    ])('refuses the unit cost %s', (unitCost, problem) => {
      expect(lineProblem(line({ unitCost }), kgVariable)).toBe(problem);
    });

    it('needs a real expiry date', () => {
      expect(lineProblem(line({ expiryDate: '2026-02-30' }), kgVariable)).toBe('EXPIRY_NOT_A_DATE');
    });
  });

  it('is kept at a plant, warehouse or branch in use, never in transit', () => {
    expect(locationProblem({ type: 'plant', active: true })).toBeNull();
    expect(locationProblem({ type: 'warehouse', active: true })).toBeNull();
    expect(locationProblem({ type: 'branch', active: true })).toBeNull();
    expect(locationProblem({ type: 'in_transit', active: true })).toBe('LOCATION_SYSTEM_MANAGED');
    expect(locationProblem({ type: 'subcontractor', active: true })).toBe(
      'LOCATION_SYSTEM_MANAGED',
    );
    expect(locationProblem({ type: 'plant', active: false })).toBe('LOCATION_INACTIVE');
  });

  describe('posting', () => {
    const doc = (overrides: Partial<PostingCandidate> = {}): PostingCandidate => ({
      businessDate: '2026-09-26',
      location: { active: true },
      lines: [
        {
          lineNo: 1,
          expiryDate: '2026-09-28',
          secondaryQuantity: '12',
          item: { active: true, variableWeight: true },
        },
        {
          lineNo: 2,
          expiryDate: '2026-09-26',
          secondaryQuantity: null,
          item: { active: true, variableWeight: false },
        },
      ],
      ...overrides,
    });
    const today = '2026-09-26';

    it('posts a complete document dated today or earlier', () => {
      expect(postingRefusal(doc(), today)).toBeNull();
      expect(postingRefusal(doc({ businessDate: '2026-09-20' }), today)).toBeNull();
    });

    it('refuses by the first rule that applies', () => {
      expect(postingRefusal(doc({ lines: [] }), today)).toEqual({ rule: 'empty_document' });
      expect(postingRefusal(doc({ businessDate: '2026-09-27' }), today)).toEqual({
        rule: 'business_date_in_future',
      });
      expect(postingRefusal(doc({ location: { active: false } }), today)).toEqual({
        rule: 'inactive_location',
      });
    });

    it('names the line an item rule refuses', () => {
      const [first, second] = doc().lines;
      expect(
        postingRefusal(
          doc({ lines: [first, { ...second, item: { ...second.item, active: false } }] }),
          today,
        ),
      ).toEqual({ rule: 'inactive_item', lineNo: 2 });
      expect(
        postingRefusal(
          doc({ lines: [{ ...first, item: { active: true, variableWeight: false } }, second] }),
          today,
        ),
      ).toEqual({ rule: 'secondary_quantity_not_allowed', lineNo: 1 });
    });

    it('refuses a lot already expired on the business date, and accepts one expiring that day', () => {
      const [first, second] = doc().lines;
      expect(
        postingRefusal(doc({ lines: [first, { ...second, expiryDate: '2026-09-25' }] }), today),
      ).toEqual({
        rule: 'expired_lot',
        lineNo: 2,
      });
      expect(postingRefusal(doc({ lines: [first, second] }), today)).toBeNull();
    });
  });
});

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  lineProblem,
  locationProblem,
  postingRefusal,
  segregationProblem,
  stepAllowed,
  type AdjustmentStatus,
  type LineInput,
  type PostingCandidate,
  type Step,
} from './adjustment-rules';

const kgVariable = { variableWeight: true, baseUnitDecimals: 3 };
const piece = { variableWeight: false, baseUnitDecimals: 0 };
const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  quantity: '-1.8',
  secondaryQuantity: '-1',
  reason: 'damaged in the chiller',
  ...overrides,
});

describe('stock-adjustment rules', () => {
  describe('a line', () => {
    it('accepts a write-off and an increase, each with or without a piece count', () => {
      expect(lineProblem(line(), kgVariable)).toBeNull();
      expect(lineProblem(line({ secondaryQuantity: null }), kgVariable)).toBeNull();
      expect(lineProblem(line({ quantity: '2.4', secondaryQuantity: '2' }), kgVariable)).toBeNull();
      expect(lineProblem(line({ quantity: '-3', secondaryQuantity: null }), piece)).toBeNull();
    });

    it.each([
      ['abc', 'QUANTITY_NOT_A_NUMBER'],
      ['1e3', 'QUANTITY_NOT_A_NUMBER'],
      ['0', 'QUANTITY_ZERO'],
      ['-0.000', 'QUANTITY_ZERO'],
      ['-1.0001', 'QUANTITY_TOO_PRECISE'],
      ['-1000000000000000', 'QUANTITY_TOO_LARGE'],
    ])('refuses the quantity %s', (quantity, problem) => {
      expect(lineProblem(line({ quantity, secondaryQuantity: null }), kgVariable)).toBe(problem);
    });

    it('keeps a counted unit to whole pieces (ADR-0019)', () => {
      expect(lineProblem(line({ quantity: '-2.5', secondaryQuantity: null }), piece)).toBe(
        'QUANTITY_TOO_PRECISE',
      );
    });

    it('records a piece count only for variable-weight items, whole and with the same sign', () => {
      expect(lineProblem(line({ quantity: '-4' }), piece)).toBe('SECONDARY_QUANTITY_NOT_ALLOWED');
      for (const count of ['0', '-1.5', 'x']) {
        expect(lineProblem(line({ secondaryQuantity: count }), kgVariable)).toBe(
          'SECONDARY_QUANTITY_INVALID',
        );
      }
      expect(lineProblem(line({ secondaryQuantity: '1' }), kgVariable)).toBe(
        'SECONDARY_QUANTITY_SIGN',
      );
      expect(lineProblem(line({ quantity: '1.8', secondaryQuantity: '-1' }), kgVariable)).toBe(
        'SECONDARY_QUANTITY_SIGN',
      );
    });

    it('needs a reason on every line', () => {
      expect(lineProblem(line({ reason: '   ' }), kgVariable)).toBe('REASON_MISSING');
      expect(lineProblem(line({ reason: 'x'.repeat(201) }), kgVariable)).toBe('REASON_TOO_LONG');
      expect(lineProblem(line({ reason: 'x'.repeat(200) }), kgVariable)).toBeNull();
    });
  });

  describe('the location', () => {
    it('is a plant, warehouse or branch in use', () => {
      expect(locationProblem({ type: 'plant', active: true })).toBeNull();
      expect(locationProblem({ type: 'warehouse', active: true })).toBeNull();
      expect(locationProblem({ type: 'branch', active: true })).toBeNull();
      expect(locationProblem({ type: 'branch', active: false })).toBe('LOCATION_INACTIVE');
      expect(locationProblem({ type: 'in_transit', active: true })).toBe('LOCATION_SYSTEM_MANAGED');
      expect(locationProblem({ type: 'subcontractor', active: true })).toBe(
        'LOCATION_SYSTEM_MANAGED',
      );
    });
  });

  describe('the steps', () => {
    const allowed: Array<[AdjustmentStatus, Step[]]> = [
      ['draft', ['edit', 'submit']],
      ['submitted', ['approve', 'reject']],
      ['approved', ['reject', 'post']],
      ['posted', []],
      ['rejected', []],
    ];
    const steps: Step[] = ['edit', 'submit', 'approve', 'reject', 'post'];

    it.each(allowed)('a %s document can take exactly %j', (status, expected) => {
      expect(steps.filter((step) => stepAllowed(status, step))).toEqual(expected);
    });
  });

  describe('segregation of duties (ADR-0008)', () => {
    it('refuses the creator, whatever roles they hold, and lets anyone else approve', () => {
      expect(segregationProblem({ createdById: 'u-plant' }, 'u-plant')).toBe('self_approval');
      expect(segregationProblem({ createdById: 'u-plant' }, 'u-finance')).toBeNull();
    });
  });

  describe('posting', () => {
    const candidate = (overrides: Partial<PostingCandidate> = {}): PostingCandidate => ({
      businessDate: '2026-09-27',
      location: { active: true },
      lines: [
        {
          lineNo: 1,
          quantity: '-1.800',
          secondaryQuantity: '-1',
          item: { active: true, variableWeight: true },
          lot: { expiryDate: '2026-09-29' },
        },
      ],
      ...overrides,
    });
    const withLine = (overrides: Partial<PostingCandidate['lines'][number]>) =>
      candidate({ lines: [{ ...candidate().lines[0], ...overrides }] });

    it('posts an adjustment dated today or earlier', () => {
      expect(postingRefusal(candidate(), '2026-09-27')).toBeNull();
      expect(postingRefusal(candidate({ businessDate: '2026-09-20' }), '2026-09-27')).toBeNull();
    });

    it.each([
      ['empty_document', candidate({ lines: [] })],
      ['business_date_in_future', candidate({ businessDate: '2026-09-28' })],
      ['inactive_location', candidate({ location: { active: false } })],
      ['inactive_item', withLine({ item: { active: false, variableWeight: true } })],
      [
        'secondary_quantity_not_allowed',
        withLine({ item: { active: true, variableWeight: false } }),
      ],
    ])('refuses by %s', (rule, doc) => {
      expect(postingRefusal(doc, '2026-09-27')?.rule).toBe(rule);
    });

    it('writes off an expired lot but never increases one (ADR-0006)', () => {
      const expired = { lot: { expiryDate: '2026-09-26' } };
      expect(postingRefusal(withLine(expired), '2026-09-27')).toBeNull();
      expect(
        postingRefusal(
          withLine({ ...expired, quantity: '1.800', secondaryQuantity: '1' }),
          '2026-09-27',
        ),
      ).toEqual({ rule: 'expired_lot', lineNo: 1 });
      // A lot expiring on the business date itself is still in date.
      expect(
        postingRefusal(
          withLine({ lot: { expiryDate: '2026-09-27' }, quantity: '1.8', secondaryQuantity: '1' }),
          '2026-09-27',
        ),
      ).toBeNull();
    });
  });
});

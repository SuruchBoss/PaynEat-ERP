// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  deliveryDateProblem,
  lineProblem,
  lineTotals,
  needsApproval,
  orderTotals,
  stepAllowed,
  submissionRefusal,
  type LineInput,
  type PricedLine,
  type PurchaseOrderStatus,
  type Step,
  type SubmissionCandidate,
} from './purchase-order-rules';

const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  quantity: '12',
  unitPrice: '1284.00',
  vatRate: '7',
  ...overrides,
});

const priced = (overrides: Partial<PricedLine> = {}): PricedLine => ({
  ...line(),
  vatRecoverable: true,
  factor: '20',
  baseUnitDecimals: 3,
  ...overrides,
});

describe('purchase order rules', () => {
  describe('a line', () => {
    const caseUnit = { decimals: 0 };

    it('accepts a whole number of cases at a price with VAT', () => {
      expect(lineProblem(line(), caseUnit)).toBeNull();
      expect(lineProblem(line({ vatRate: '0' }), caseUnit)).toBeNull();
      expect(lineProblem(line({ unitPrice: '0.3750', vatRate: '1.5' }), caseUnit)).toBeNull();
      expect(lineProblem(line({ quantity: '2.5' }), { decimals: 3 })).toBeNull();
    });

    it.each([
      [{ quantity: 'twelve' }, 'QUANTITY_NOT_A_NUMBER'],
      [{ quantity: '0' }, 'QUANTITY_NOT_POSITIVE'],
      [{ quantity: '-1' }, 'QUANTITY_NOT_POSITIVE'],
      [{ quantity: '2.5' }, 'QUANTITY_TOO_PRECISE'],
      [{ quantity: '1000000000000000' }, 'QUANTITY_TOO_LARGE'],
      [{ unitPrice: '' }, 'PRICE_NOT_A_NUMBER'],
      [{ unitPrice: '0.00' }, 'PRICE_NOT_POSITIVE'],
      [{ unitPrice: '1.23456' }, 'PRICE_TOO_PRECISE'],
      [{ unitPrice: '100000000000000' }, 'PRICE_TOO_LARGE'],
      [{ vatRate: 'seven' }, 'VAT_RATE_NOT_A_NUMBER'],
      [{ vatRate: '-7' }, 'VAT_RATE_OUT_OF_RANGE'],
      [{ vatRate: '100.01' }, 'VAT_RATE_OUT_OF_RANGE'],
      [{ vatRate: '7.125' }, 'VAT_RATE_TOO_PRECISE'],
    ] as const)('refuses %j: %s', (overrides, problem) => {
      expect(lineProblem(line(overrides), caseUnit)).toBe(problem);
    });
  });

  describe('money, rounded once (ADR-0024)', () => {
    it('worked example 1: whole chicken by the case, VAT recoverable', () => {
      // 12 × 1,284.00 = 15,408.00; 7% of it = 1,078.56; 12 cases of 20 kg = 240 kg;
      // recoverable VAT is not a cost, so a kg costs 1,284.00 / 20 = 64.20.
      expect(lineTotals(priced())).toEqual({
        net: '15408.00',
        vat: '1078.56',
        gross: '16486.56',
        baseQuantity: '240.000',
        unitCost: '64.200000',
      });
    });

    it('worked example 2: the same line with VAT not recoverable puts the VAT in the cost', () => {
      // 1,284.00 × 1.07 = 1,373.88 a case, / 20 = 68.694 a kg.
      expect(lineTotals(priced({ vatRecoverable: false })).unitCost).toBe('68.694000');
      expect(lineTotals(priced({ vatRecoverable: false })).gross).toBe('16486.56');
    });

    it('worked example 3: flour by the bag, a price that does not divide evenly', () => {
      // 7 bags × 812.35 = 5,686.45; VAT 7% = 398.0515 → 398.05; gross 6,084.50;
      // 7 × 25 kg = 175 kg; a kg costs 812.35 / 25 = 32.494.
      expect(lineTotals(priced({ quantity: '7', unitPrice: '812.35', factor: '25' }))).toEqual({
        net: '5686.45',
        vat: '398.05',
        gross: '6084.50',
        baseQuantity: '175.000',
        unitCost: '32.494000',
      });
    });

    it('rounds half away from zero, once, at the line', () => {
      // 3 × 0.3750 = 1.125 → 1.13 (half away from zero, not to even)
      expect(lineTotals(priced({ quantity: '3', unitPrice: '0.3750', factor: '1' })).net).toBe(
        '1.13',
      );
      // VAT on 0.07 at 7% = 0.0049 → 0.00; on 0.08 = 0.0056 → 0.01
      expect(lineTotals(priced({ quantity: '1', unitPrice: '0.07', factor: '1' })).vat).toBe(
        '0.00',
      );
      expect(lineTotals(priced({ quantity: '1', unitPrice: '0.08', factor: '1' })).vat).toBe(
        '0.01',
      );
    });

    it('takes the unit cost from the price, not from the rounded net', () => {
      // 1 tin of oil at 100.00 holds 18 l: 5.555555… → 5.555556 a litre, whatever the quantity.
      const one = lineTotals(priced({ quantity: '1', unitPrice: '100.00', factor: '18' }));
      const seven = lineTotals(priced({ quantity: '7', unitPrice: '100.00', factor: '18' }));
      expect(one.unitCost).toBe('5.555556');
      expect(seven.unitCost).toBe('5.555556');
    });

    it('rounds the base quantity to the base unit (ADR-0019)', () => {
      expect(
        lineTotals(priced({ quantity: '3', factor: '0.3333', baseUnitDecimals: 0 })).baseQuantity,
      ).toBe('1');
      expect(
        lineTotals(priced({ quantity: '3', factor: '0.3335', baseUnitDecimals: 3 })).baseQuantity,
      ).toBe('1.001');
    });

    it('adds the order up from its rounded lines, so the lines always sum to the total', () => {
      const lines = [
        lineTotals(priced()),
        lineTotals(priced({ quantity: '7', unitPrice: '812.35', factor: '25' })),
        lineTotals(priced({ quantity: '1', unitPrice: '0.08', factor: '1' })),
      ];
      expect(orderTotals(lines)).toEqual({
        net: '21094.53',
        vat: '1476.62',
        gross: '22571.15',
      });
      expect(orderTotals([])).toEqual({ net: '0.00', vat: '0.00', gross: '0.00' });
    });
  });

  describe('the approval threshold', () => {
    it('needs an approver only above the threshold; at or below it approves itself', () => {
      expect(needsApproval('20000.01', '20000')).toBe(true);
      expect(needsApproval('20000.00', '20000')).toBe(false);
      expect(needsApproval('19999.99', '20000.00')).toBe(false);
      // A threshold of zero sends every order to an approver.
      expect(needsApproval('0.01', '0')).toBe(true);
    });
  });

  describe('steps', () => {
    const allowed: Record<Step, PurchaseOrderStatus[]> = {
      edit: ['draft'],
      submit: ['draft'],
      approve: ['submitted'],
      reject: ['submitted'],
      send: ['approved'],
      cancel: ['draft', 'submitted', 'approved', 'sent'],
    };
    const statuses: PurchaseOrderStatus[] = [
      'draft',
      'submitted',
      'approved',
      'sent',
      'partially_received',
      'received',
      'rejected',
      'cancelled',
    ];

    it.each(Object.keys(allowed) as Step[])('allows %s only from its own statuses', (step) => {
      for (const status of statuses) {
        expect(stepAllowed(status, step)).toBe(allowed[step].includes(status));
      }
    });

    it('cannot cancel once anything has been received', () => {
      expect(stepAllowed('partially_received', 'cancel')).toBe(false);
      expect(stepAllowed('received', 'cancel')).toBe(false);
    });
  });

  describe('the expected delivery date', () => {
    it('is a real date, today or later', () => {
      expect(deliveryDateProblem('2026-10-05', '2026-10-05')).toBeNull();
      expect(deliveryDateProblem('2027-01-01', '2026-12-31')).toBeNull();
      expect(deliveryDateProblem('2026-10-04', '2026-10-05')).toBe('DELIVERY_DATE_PAST');
      expect(deliveryDateProblem('2026-02-30', '2026-01-01')).toBe('DELIVERY_DATE_INVALID');
      expect(deliveryDateProblem('5 Oct', '2026-01-01')).toBe('DELIVERY_DATE_INVALID');
    });
  });

  describe('submission', () => {
    const candidate = (overrides: Partial<SubmissionCandidate> = {}): SubmissionCandidate => ({
      supplier: { active: true },
      location: { active: true, type: 'plant' },
      lines: [{ lineNo: 1, item: { active: true }, unitIsPurchaseUnit: true }],
      ...overrides,
    });

    it('accepts an order to an active supplier, delivered to a plant or warehouse', () => {
      expect(submissionRefusal(candidate())).toBeNull();
      expect(
        submissionRefusal(candidate({ location: { active: true, type: 'warehouse' } })),
      ).toBeNull();
    });

    it.each([
      [{ lines: [] }, { rule: 'empty_order' }],
      [{ supplier: { active: false } }, { rule: 'inactive_supplier' }],
      [{ location: { active: false, type: 'plant' } }, { rule: 'inactive_location' }],
      [{ location: { active: true, type: 'branch' } }, { rule: 'location_not_receiving' }],
      [
        { lines: [{ lineNo: 2, item: { active: false }, unitIsPurchaseUnit: true }] },
        { rule: 'inactive_item', lineNo: 2 },
      ],
      [
        { lines: [{ lineNo: 1, item: { active: true }, unitIsPurchaseUnit: false }] },
        { rule: 'unit_not_purchase_unit', lineNo: 1 },
      ],
    ] as const)('refuses %j', (overrides, refusal) => {
      expect(submissionRefusal(candidate(overrides as Partial<SubmissionCandidate>))).toEqual(
        refusal,
      );
    });
  });
});

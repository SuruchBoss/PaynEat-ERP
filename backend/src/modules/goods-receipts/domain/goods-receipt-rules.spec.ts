// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  acceptedPieces,
  acceptedQuantity,
  lineComplete,
  lineProblem,
  lotExpiry,
  needsApproval,
  orderStatusAfterReceipt,
  outstandingQuantity,
  reasonRequired,
  receiptRefusal,
  stepAllowed,
  withinReceivableLimit,
  type CheckedLine,
  type GoodsReceiptStatus,
  type LineInput,
  type Step,
} from './goods-receipt-rules';

const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  countedQuantity: '238.4',
  rejectedQuantity: '0',
  countedPieces: '132',
  rejectedPieces: '0',
  temperature: '2.8',
  condition: 'good',
  supplierExpiry: null,
  reason: null,
  ...overrides,
});

const kg = { decimals: 3 };
const birds = { variableWeight: true };
const flour = { variableWeight: false };

describe('goods receipt rules', () => {
  describe('a line', () => {
    it('accepts whole chicken weighed with its bird count', () => {
      expect(lineProblem(line(), kg, birds)).toBeNull();
      expect(
        lineProblem(line({ rejectedQuantity: '18.2', rejectedPieces: '10' }), kg, birds),
      ).toBeNull();
    });

    it('accepts an item without a piece count', () => {
      expect(
        lineProblem(
          line({ countedQuantity: '8', countedPieces: null, rejectedPieces: null }),
          { decimals: 0 },
          flour,
        ),
      ).toBeNull();
    });

    it('needs something counted, no more precise than its unit', () => {
      expect(lineProblem(line({ countedQuantity: '0' }), kg, birds)).toBe('COUNTED_NOT_POSITIVE');
      expect(lineProblem(line({ countedQuantity: 'lots' }), kg, birds)).toBe(
        'COUNTED_NOT_A_NUMBER',
      );
      expect(lineProblem(line({ countedQuantity: '238.4001' }), kg, birds)).toBe(
        'COUNTED_TOO_PRECISE',
      );
      expect(
        lineProblem(
          line({ countedQuantity: '1.5', countedPieces: null, rejectedPieces: null }),
          { decimals: 0 },
          flour,
        ),
      ).toBe('COUNTED_TOO_PRECISE');
    });

    it('rejects between nothing and everything counted', () => {
      expect(lineProblem(line({ rejectedQuantity: '-1' }), kg, birds)).toBe('REJECTED_NEGATIVE');
      expect(
        lineProblem(line({ rejectedQuantity: '238.401', rejectedPieces: '1' }), kg, birds),
      ).toBe('REJECTED_MORE_THAN_COUNTED');
      expect(
        lineProblem(line({ rejectedQuantity: '238.4', rejectedPieces: '132' }), kg, birds),
      ).toBeNull();
    });

    it('requires pieces for a variable-weight item, and forbids them otherwise (ADR-0005)', () => {
      expect(lineProblem(line({ countedPieces: null }), kg, birds)).toBe('PIECES_REQUIRED');
      expect(lineProblem(line({ countedPieces: '12.5' }), kg, birds)).toBe(
        'PIECES_NOT_A_WHOLE_NUMBER',
      );
      expect(lineProblem(line({ countedPieces: '0' }), kg, birds)).toBe('PIECES_NOT_POSITIVE');
      expect(lineProblem(line({ rejectedPieces: '133' }), kg, birds)).toBe(
        'REJECTED_PIECES_MORE_THAN_COUNTED',
      );
      expect(lineProblem(line(), kg, flour)).toBe('PIECES_NOT_ALLOWED');
    });

    it('keeps pieces with weight: no birds rejected without weight, and none the other way', () => {
      expect(lineProblem(line({ rejectedQuantity: '18.2' }), kg, birds)).toBe(
        'PIECES_DO_NOT_MATCH_QUANTITY',
      );
      expect(lineProblem(line({ rejectedPieces: '10' }), kg, birds)).toBe(
        'PIECES_DO_NOT_MATCH_QUANTITY',
      );
      expect(
        lineProblem(line({ rejectedQuantity: '238.4', rejectedPieces: '131' }), kg, birds),
      ).toBe('PIECES_DO_NOT_MATCH_QUANTITY');
    });

    it('checks the temperature, condition, expiry and reason it records', () => {
      expect(lineProblem(line({ temperature: 'cold' }), kg, birds)).toBe(
        'TEMPERATURE_NOT_A_NUMBER',
      );
      expect(lineProblem(line({ temperature: null }), kg, birds)).toBeNull();
      expect(lineProblem(line({ condition: 'bruised' }), kg, birds)).toBe('CONDITION_UNKNOWN');
      expect(lineProblem(line({ supplierExpiry: '2026-02-30' }), kg, birds)).toBe(
        'SUPPLIER_EXPIRY_INVALID',
      );
      expect(lineProblem(line({ reason: 'x'.repeat(501) }), kg, birds)).toBe('REASON_TOO_LONG');
    });
  });

  it('accepts counted minus rejected, exactly', () => {
    expect(acceptedQuantity('402.000', '18.200', 3)).toBe('383.800');
    expect(acceptedPieces('220', '10')).toBe('210');
    expect(acceptedPieces(null, null)).toBeNull();
  });

  describe('lot expiry (ADR-0014)', () => {
    it('takes receipt date plus shelf life when the supplier prints nothing or later', () => {
      expect(lotExpiry('2026-10-09', 5, null)).toEqual({
        computedExpiry: '2026-10-14',
        supplierExpiry: null,
        expiryDate: '2026-10-14',
        takes: 'computed',
      });
      expect(lotExpiry('2026-10-09', 5, '2026-10-15').takes).toBe('computed');
      expect(lotExpiry('2026-10-09', 5, '2026-10-14').takes).toBe('computed');
    });

    it('takes the supplier date when it is earlier, keeping both', () => {
      expect(lotExpiry('2026-10-09', 5, '2026-10-13')).toEqual({
        computedExpiry: '2026-10-14',
        supplierExpiry: '2026-10-13',
        expiryDate: '2026-10-13',
        takes: 'supplier',
      });
    });

    it('counts across a month end', () => {
      expect(lotExpiry('2026-10-30', 5, null).computedExpiry).toBe('2026-11-04');
    });
  });

  it('needs a reason for a finding or for anything turned away', () => {
    expect(reasonRequired([], '0')).toBe(false);
    expect(reasonRequired([], '18.200')).toBe(true);
    expect(reasonRequired([{ code: 'damaged' }], '0')).toBe(true);
  });

  describe('how much an order line may receive', () => {
    it('allows ordered plus the variance limit, and exactly ordered without one', () => {
      const base = { ordered: '240.000', alreadyAccepted: '0', maxVariancePercent: '2' };
      expect(withinReceivableLimit({ ...base, accepting: '244.800' })).toBe(true);
      expect(withinReceivableLimit({ ...base, accepting: '244.801' })).toBe(false);
      expect(
        withinReceivableLimit({ ...base, maxVariancePercent: null, accepting: '240.000' }),
      ).toBe(true);
      expect(
        withinReceivableLimit({ ...base, maxVariancePercent: null, accepting: '240.001' }),
      ).toBe(false);
    });

    it('counts what earlier receipts accepted', () => {
      expect(
        withinReceivableLimit({
          ordered: '240.000',
          alreadyAccepted: '200.000',
          accepting: '44.800',
          maxVariancePercent: '2',
        }),
      ).toBe(true);
      expect(
        withinReceivableLimit({
          ordered: '240.000',
          alreadyAccepted: '200.000',
          accepting: '44.801',
          maxVariancePercent: '2',
        }),
      ).toBe(false);
    });

    it('expects what is still outstanding, never less than nothing', () => {
      expect(outstandingQuantity('240.000', '200.000', 3)).toBe('40.000');
      expect(outstandingQuantity('240.000', '242.000', 3)).toBe('0.000');
    });
  });

  describe('when an order line is complete', () => {
    it('within the variance limit below what was ordered', () => {
      expect(lineComplete('240.000', '238.400', '2')).toBe(true);
      expect(lineComplete('240.000', '235.200', '2')).toBe(true);
      expect(lineComplete('240.000', '235.199', '2')).toBe(false);
      expect(lineComplete('400.000', '383.800', '2')).toBe(false);
    });

    it('only at what was ordered without a limit', () => {
      expect(lineComplete('8', '8', null)).toBe(true);
      expect(lineComplete('8', '7', null)).toBe(false);
    });

    it('makes the order received only when every line is', () => {
      const line = (complete: boolean, received: string) => ({ complete, received });
      expect(orderStatusAfterReceipt([line(true, '240.000'), line(true, '8')])).toBe('received');
      expect(orderStatusAfterReceipt([line(true, '240.000'), line(false, '0')])).toBe(
        'partially_received',
      );
    });

    it('leaves the order as it was when nothing has been accepted on it', () => {
      expect(orderStatusAfterReceipt([{ complete: false, received: '0.000' }])).toBeNull();
    });
  });

  describe('steps', () => {
    const cases: Array<[GoodsReceiptStatus, Step, boolean]> = [
      ['draft', 'edit', true],
      ['draft', 'submit', true],
      ['draft', 'approve', false],
      ['submitted', 'edit', false],
      ['submitted', 'approve', true],
      ['submitted', 'reject', true],
      ['approved', 'post', true],
      ['approved', 'reject', true],
      ['posted', 'reject', false],
      ['rejected', 'submit', false],
    ];
    it.each(cases)('%s → %s: %s', (status, step, allowed) => {
      expect(stepAllowed(status, step)).toBe(allowed);
    });
  });

  describe('refusals', () => {
    const checked = (overrides: Partial<CheckedLine> = {}): CheckedLine => ({
      lineNo: 1,
      item: { active: true },
      temperatureRequired: false,
      findings: [],
      rejectedQuantity: '0.000',
      acceptedQuantity: '238.400',
      reason: null,
      expiryDate: '2026-10-14',
      withinReceivableLimit: true,
      ...overrides,
    });
    const receipt = (lines: CheckedLine[], orderStatus = 'sent') => ({
      businessDate: '2026-10-09',
      orderStatus,
      location: { active: true },
      lines,
    });

    it('lets a clean receipt through', () => {
      expect(receiptRefusal(receipt([checked()]))).toBeNull();
      expect(receiptRefusal(receipt([checked()], 'approved'))).toBeNull();
      expect(receiptRefusal(receipt([checked()], 'partially_received'))).toBeNull();
    });

    it('refuses an empty receipt, or one against an order that cannot receive', () => {
      expect(receiptRefusal(receipt([]))).toEqual({ rule: 'empty_document' });
      for (const status of ['draft', 'submitted', 'received', 'cancelled', 'rejected']) {
        expect(receiptRefusal(receipt([checked()], status))).toEqual({
          rule: 'order_not_receivable',
        });
      }
    });

    it('refuses an inactive location or item', () => {
      expect(receiptRefusal({ ...receipt([checked()]), location: { active: false } })).toEqual({
        rule: 'inactive_location',
      });
      expect(receiptRefusal(receipt([checked({ item: { active: false } })]))).toEqual({
        rule: 'inactive_item',
        lineNo: 1,
      });
    });

    it('needs a temperature where the item has a limit', () => {
      expect(receiptRefusal(receipt([checked({ temperatureRequired: true })]))).toEqual({
        rule: 'temperature_required',
        lineNo: 1,
      });
    });

    it('needs a reason for a finding or a rejection', () => {
      expect(
        receiptRefusal(receipt([checked({ findings: [{ code: 'damaged' }], reason: '  ' })])),
      ).toEqual({ rule: 'reason_required', lineNo: 1 });
      expect(receiptRefusal(receipt([checked({ rejectedQuantity: '1.000' })]))).toEqual({
        rule: 'reason_required',
        lineNo: 1,
      });
      expect(
        receiptRefusal(
          receipt([checked({ findings: [{ code: 'damaged' }], reason: 'Torn packaging' })]),
        ),
      ).toBeNull();
    });

    it('never accepts goods already expired on arrival (ADR-0006)', () => {
      expect(receiptRefusal(receipt([checked({ expiryDate: '2026-10-08' })]))).toEqual({
        rule: 'expired_on_arrival',
        lineNo: 1,
      });
      expect(receiptRefusal(receipt([checked({ expiryDate: '2026-10-09' })]))).toBeNull();
      expect(
        receiptRefusal(
          receipt([
            checked({
              expiryDate: '2026-10-08',
              acceptedQuantity: '0.000',
              rejectedQuantity: '238.400',
              reason: 'Expired',
            }),
          ]),
        ),
      ).toBeNull();
    });

    it('refuses receiving beyond the limit', () => {
      expect(receiptRefusal(receipt([checked({ withinReceivableLimit: false })]))).toEqual({
        rule: 'over_receipt',
        lineNo: 1,
      });
    });

    it('names the first line that fails', () => {
      expect(
        receiptRefusal(receipt([checked(), checked({ lineNo: 2, item: { active: false } })])),
      ).toEqual({ rule: 'inactive_item', lineNo: 2 });
    });
  });

  it('needs an approval when any line has a finding', () => {
    expect(needsApproval([{ findings: [] }, { findings: [] }])).toBe(false);
    expect(needsApproval([{ findings: [] }, { findings: [{ code: 'damaged' }] }])).toBe(true);
  });
});

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { inspect, type ReceivingTolerances } from '../../../core/receiving/domain/inspection';
import {
  differenceResolved,
  dispatchBlockers,
  dispatchReversalRefusal,
  needsApproval,
  positiveQuantityProblem,
  reasonRequired,
  receiptLineProblem,
  receiptRefusal,
  receiptStepAllowed,
  routeProblem,
  shortBy,
  total,
  transferStatus,
  unresolved,
  type CheckedReceiptLine,
  type ReceiptLineInput,
} from './transfer-rules';

const KG = { decimals: 3, variableWeight: false };
const BIRDS = { decimals: 3, variableWeight: true };

const plain = (overrides: Partial<ReceiptLineInput> = {}): ReceiptLineInput => ({
  received: '20',
  receivedPieces: null,
  temperature: '3.2',
  condition: 'good',
  accepted: '20',
  acceptedPieces: null,
  returned: '0',
  returnedPieces: null,
  writtenOff: '0',
  writtenOffPieces: null,
  reason: null,
  ...overrides,
});

const birds = (overrides: Partial<ReceiptLineInput> = {}): ReceiptLineInput =>
  plain({
    receivedPieces: '11',
    acceptedPieces: '11',
    returnedPieces: '0',
    writtenOffPieces: '0',
    ...overrides,
  });

describe('routes (#14)', () => {
  const plant = { id: 'p', type: 'plant' as const, active: true };
  const warehouse = { id: 'w', type: 'warehouse' as const, active: true };
  const branch = { id: 'b', type: 'branch' as const, active: true };

  it('sends from a plant or warehouse to a branch or warehouse', () => {
    expect(routeProblem(plant, branch)).toBeNull();
    expect(routeProblem(plant, warehouse)).toBeNull();
    expect(routeProblem(warehouse, branch)).toBeNull();
  });

  it('refuses any other route, and a location that is not in use', () => {
    expect(routeProblem(branch, plant)).toBe('ORIGIN_NOT_PLANT_OR_WAREHOUSE');
    expect(routeProblem(plant, { ...plant, id: 'p2' })).toBe('DESTINATION_NOT_BRANCH_OR_WAREHOUSE');
    expect(routeProblem(warehouse, warehouse)).toBe('SAME_LOCATION');
    expect(routeProblem({ ...plant, active: false }, branch)).toBe('ORIGIN_INACTIVE');
    expect(routeProblem(plant, { ...branch, active: false })).toBe('DESTINATION_INACTIVE');
  });
});

describe('quantities', () => {
  it('asks for more than zero, as precise as the unit allows', () => {
    expect(positiveQuantityProblem('19.8', 3)).toBeNull();
    expect(positiveQuantityProblem('0', 3)).toBe('NOT_POSITIVE');
    expect(positiveQuantityProblem('1.2345', 3)).toBe('TOO_PRECISE');
    expect(positiveQuantityProblem('2.5', 0)).toBe('TOO_PRECISE');
    expect(positiveQuantityProblem('ten', 3)).toBe('NOT_A_NUMBER');
    expect(positiveQuantityProblem('1234567890123456', 0)).toBe('TOO_LARGE');
  });

  it('adds picks exactly and reports what they leave unfilled', () => {
    expect(total(['19.8', '0.2', '4.035'])).toBe('24.035');
    expect(shortBy('25', ['19.8', '4.035'])).toBe('1.165');
    expect(shortBy('20', ['19.8', '0.3'])).toBe('0');
  });
});

describe('dispatch blockers (#14)', () => {
  const lots = new Map([
    ['fresh', { expiryDate: '2026-10-13' }],
    ['old', { expiryDate: '2026-10-09' }],
  ]);
  const line = (lineNo: number, variableWeight = false) => ({
    lineNo,
    item: { active: true, variableWeight },
  });

  it('lets a dispatch with an unexpired lot on every line through', () => {
    expect(
      dispatchBlockers({
        businessDate: '2026-10-10',
        locationsActive: true,
        lines: [line(1)],
        picks: [{ lineNo: 1, lotId: 'fresh', quantity: '20', pieces: null }],
        lots,
      }),
    ).toEqual([]);
  });

  it('lists every reason it cannot leave, in order', () => {
    expect(
      dispatchBlockers({
        businessDate: '2026-10-10',
        locationsActive: false,
        lines: [
          line(1),
          line(2, true),
          { lineNo: 3, item: { active: false, variableWeight: false } },
        ],
        picks: [
          { lineNo: 2, lotId: 'old', quantity: '4', pieces: null },
          { lineNo: 3, lotId: 'fresh', quantity: '1', pieces: null },
        ],
        lots,
      }),
    ).toEqual([
      { rule: 'inactive_location' },
      { rule: 'nothing_picked', lineNo: 1 },
      { rule: 'expired_lot', lineNo: 2, lotId: 'old' },
      { rule: 'pieces_required', lineNo: 2, lotId: 'old' },
      { rule: 'inactive_item', lineNo: 3 },
    ]);
  });

  it('a lot expiring on the dispatch date is still usable that day', () => {
    expect(
      dispatchBlockers({
        businessDate: '2026-10-13',
        locationsActive: true,
        lines: [line(1)],
        picks: [{ lineNo: 1, lotId: 'fresh', quantity: '1', pieces: null }],
        lots,
      }),
    ).toEqual([]);
  });

  it('refuses an empty transfer', () => {
    expect(
      dispatchBlockers({
        businessDate: '2026-10-10',
        locationsActive: true,
        lines: [],
        picks: [],
        lots,
      }),
    ).toEqual([{ rule: 'empty_document' }]);
  });
});

describe('receipt lines (#14)', () => {
  it('accepts a clean line and a line in pieces', () => {
    expect(receiptLineProblem(plain(), KG)).toBeNull();
    expect(receiptLineProblem(birds(), BIRDS)).toBeNull();
  });

  it('accepts only what arrived, and returns only what arrived and was turned away', () => {
    expect(receiptLineProblem(plain({ received: '18', accepted: '19' }), KG)).toBe(
      'ACCEPTED_MORE_THAN_RECEIVED',
    );
    // 18 arrived, 15 accepted: at most 3 can go back on the truck; the 2 that never came are
    // written off.
    expect(
      receiptLineProblem(plain({ received: '18', accepted: '15', returned: '3' }), KG),
    ).toBeNull();
    expect(
      receiptLineProblem(plain({ received: '18', accepted: '15', returned: '3.001' }), KG),
    ).toBe('RETURNED_MORE_THAN_TURNED_AWAY');
  });

  it('refuses quantities below zero or more precise than the unit', () => {
    expect(receiptLineProblem(plain({ received: '-1' }), KG)).toBe('RECEIVED_INVALID');
    expect(receiptLineProblem(plain({ accepted: '1.0001' }), KG)).toBe('ACCEPTED_INVALID');
    expect(receiptLineProblem(plain({ returned: 'x' }), KG)).toBe('RETURNED_INVALID');
    expect(receiptLineProblem(plain({ writtenOff: '-0.1' }), KG)).toBe('WRITTEN_OFF_INVALID');
  });

  it('keeps pieces with weight for variable-weight items, and only for them', () => {
    expect(receiptLineProblem(birds({ returnedPieces: null }), BIRDS)).toBe('PIECES_REQUIRED');
    expect(receiptLineProblem(birds({ receivedPieces: '10.5' }), BIRDS)).toBe('PIECES_INVALID');
    expect(receiptLineProblem(birds({ writtenOffPieces: '1' }), BIRDS)).toBe(
      'PIECES_WITHOUT_QUANTITY',
    );
    expect(receiptLineProblem(birds({ acceptedPieces: '0' }), BIRDS)).toBe(
      'ACCEPTED_WITHOUT_PIECES',
    );
    expect(receiptLineProblem(plain({ acceptedPieces: '11' }), KG)).toBe('PIECES_NOT_ALLOWED');
    // Weight lost on the road with every bird still there.
    expect(
      receiptLineProblem(birds({ received: '19.6', accepted: '19.6', writtenOff: '0.4' }), BIRDS),
    ).toBeNull();
  });

  it('checks temperature, condition and reason like a goods receipt', () => {
    expect(receiptLineProblem(plain({ temperature: '3.25' }), KG)).toBe('TEMPERATURE_TOO_PRECISE');
    expect(receiptLineProblem(plain({ condition: 'soggy' }), KG)).toBe('CONDITION_UNKNOWN');
    expect(receiptLineProblem(plain({ reason: 'x'.repeat(501) }), KG)).toBe('REASON_TOO_LONG');
  });
});

describe('every dispatched quantity is accounted for (#14, ADR-0007)', () => {
  it('needs accepted, returned and written off to add up to what was dispatched exactly', () => {
    const dispatched = { quantity: '20', pieces: null };
    expect(differenceResolved(dispatched, plain())).toBe(true);
    expect(
      differenceResolved(dispatched, plain({ accepted: '18.5', returned: '1', writtenOff: '0.5' })),
    ).toBe(true);
    expect(differenceResolved(dispatched, plain({ accepted: '19.999' }))).toBe(false);
    expect(differenceResolved(dispatched, plain({ accepted: '20', writtenOff: '0.001' }))).toBe(
      false,
    );
  });

  it('counts pieces too, so no bird stays on the truck', () => {
    const dispatched = { quantity: '20', pieces: '11' };
    expect(differenceResolved(dispatched, birds())).toBe(true);
    expect(
      differenceResolved(
        dispatched,
        birds({ accepted: '18', acceptedPieces: '10', writtenOff: '2', writtenOffPieces: '0' }),
      ),
    ).toBe(false);
    expect(
      differenceResolved(
        dispatched,
        birds({ accepted: '18', acceptedPieces: '10', writtenOff: '2', writtenOffPieces: '1' }),
      ),
    ).toBe(true);
  });

  it('shows what is still to resolve', () => {
    expect(unresolved('20', { accepted: '18', returned: '0', writtenOff: '0.5' })).toBe('1.5');
    expect(unresolved('20', { accepted: '20', returned: '0', writtenOff: '0' })).toBe('0');
  });
});

describe('reasons and approval (#14)', () => {
  const tolerances: ReceivingTolerances = { maxVariancePercent: '2', maxTemperature: '4' };
  const findings = (received: string, temperature: string | null, condition: 'good' | 'damaged') =>
    inspect({
      expectedQuantity: '20',
      countedQuantity: received,
      temperature,
      condition,
      tolerances,
      computedExpiry: '2026-10-13',
      supplierExpiry: null,
    });

  it('uses the goods receipt inspection unchanged: short, warm and damaged are findings', () => {
    expect(findings('19.6', '3.9', 'good')).toEqual([]);
    expect(findings('19.5', '3.9', 'good').map((f) => f.code)).toEqual(['under_quantity']);
    expect(findings('20', '5.1', 'damaged').map((f) => f.code)).toEqual(['too_warm', 'damaged']);
  });

  it('asks why for a finding, a return or a write-off', () => {
    expect(reasonRequired([], { returned: '0', writtenOff: '0' })).toBe(false);
    expect(reasonRequired([], { returned: '1', writtenOff: '0' })).toBe(true);
    expect(reasonRequired([], { returned: '0', writtenOff: '0.4' })).toBe(true);
    expect(reasonRequired(findings('20', '5.1', 'good'), { returned: '0', writtenOff: '0' })).toBe(
      true,
    );
  });

  it('sends a finding or a write-off to someone else for approval, never a plain return', () => {
    expect(needsApproval([{ findings: [], writtenOff: '0' }])).toBe(false);
    expect(needsApproval([{ findings: findings('20', '5.1', 'good'), writtenOff: '0' }])).toBe(
      true,
    );
    expect(needsApproval([{ findings: [], writtenOff: '0.4' }])).toBe(true);
  });
});

describe('receipt refusals (#14)', () => {
  const checked = (overrides: Partial<CheckedReceiptLine> = {}): CheckedReceiptLine => ({
    lineNo: 1,
    temperatureRequired: false,
    findings: [],
    resolved: true,
    accepted: '20',
    returned: '0',
    writtenOff: '0',
    reason: null,
    expiryDate: '2026-10-13',
    ...overrides,
  });
  const receipt = (overrides: Partial<Parameters<typeof receiptRefusal>[0]> = {}) => ({
    businessDate: '2026-10-11',
    transferStatus: 'dispatched' as const,
    dispatchDate: '2026-10-10',
    destinationActive: true,
    lines: [checked()],
    ...overrides,
  });

  it('lets a clean receipt of a dispatched transfer through', () => {
    expect(receiptRefusal(receipt())).toBeNull();
  });

  it('posts at most one receipt per transfer, never before the dispatch', () => {
    expect(receiptRefusal(receipt({ transferStatus: 'received' }))).toEqual({
      rule: 'already_received',
    });
    expect(receiptRefusal(receipt({ transferStatus: 'reversed' }))).toEqual({
      rule: 'transfer_reversed',
    });
    expect(receiptRefusal(receipt({ transferStatus: 'draft' }))).toEqual({
      rule: 'transfer_not_dispatched',
    });
    expect(receiptRefusal(receipt({ businessDate: '2026-10-09' }))).toEqual({
      rule: 'business_date_before_dispatch',
    });
  });

  it('refuses to leave anything in transit, or to take in an unexplained difference', () => {
    expect(receiptRefusal(receipt({ lines: [checked({ resolved: false })] }))).toEqual({
      rule: 'difference_unresolved',
      lineNo: 1,
    });
    expect(
      receiptRefusal(receipt({ lines: [checked({ accepted: '19', writtenOff: '1' })] })),
    ).toEqual({ rule: 'reason_required', lineNo: 1 });
    expect(receiptRefusal(receipt({ lines: [checked({ temperatureRequired: true })] }))).toEqual({
      rule: 'temperature_required',
      lineNo: 1,
    });
  });

  it('never takes a lot that expired on the way into a branch, but lets it go back', () => {
    const late = receipt({ businessDate: '2026-10-14' });
    expect(receiptRefusal(late)).toEqual({ rule: 'expired_on_arrival', lineNo: 1 });
    expect(
      receiptRefusal({
        ...late,
        lines: [checked({ accepted: '0', returned: '20', reason: 'expired on the way' })],
      }),
    ).toBeNull();
  });

  it('lets everything go back from a destination no longer in use, and nothing in', () => {
    expect(receiptRefusal(receipt({ destinationActive: false }))).toEqual({
      rule: 'inactive_location',
    });
    expect(
      receiptRefusal(
        receipt({
          destinationActive: false,
          lines: [checked({ accepted: '0', returned: '20', reason: 'branch closed' })],
        }),
      ),
    ).toBeNull();
  });
});

describe('steps and status', () => {
  it('moves a receipt draft → submitted → approved → posted, or rejected', () => {
    expect(receiptStepAllowed('draft', 'edit')).toBe(true);
    expect(receiptStepAllowed('submitted', 'edit')).toBe(false);
    expect(receiptStepAllowed('submitted', 'approve')).toBe(true);
    expect(receiptStepAllowed('approved', 'reject')).toBe(true);
    expect(receiptStepAllowed('approved', 'post')).toBe(true);
    expect(receiptStepAllowed('rejected', 'submit')).toBe(false);
  });

  it('reads a transfer as received once its receipt posted', () => {
    expect(transferStatus('draft', false)).toBe('draft');
    expect(transferStatus('cancelled', false)).toBe('cancelled');
    expect(transferStatus('posted', false)).toBe('dispatched');
    expect(transferStatus('posted', true)).toBe('received');
    expect(transferStatus('posted', false, true)).toBe('reversed');
    // A draft or cancelled transfer was never dispatched, so never reversed.
    expect(transferStatus('cancelled', false, true)).toBe('cancelled');
  });

  it('reverses a dispatch only while no receipt of it has posted', () => {
    expect(dispatchReversalRefusal('dispatched')).toBeNull();
    expect(dispatchReversalRefusal('received')).toBe('already_received');
  });
});

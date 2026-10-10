// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { parseDecimal, formatMinimal } from '../../../core/quantity/domain/exact-decimal';
import {
  isMultiple,
  lineMissed,
  linesProblem,
  outstanding,
  quantityProblem,
  requisitionStatus,
  roundUpToMultiple,
  stepAllowed,
  submitProblem,
  suggestedQuantity,
  undispatched,
} from './requisition-rules';

const d = (text: string) => parseDecimal(text)!;

describe('requisition rules (#15)', () => {
  describe('the suggestion', () => {
    it('is par less the branch balance less what is already on the road', () => {
      expect(
        suggestedQuantity({ par: '40', balance: '12', inTransit: '10', requisitionUnit: null }),
      ).toBe('18');
    });

    it('asks for more when the branch balance is negative: the shortfall is real', () => {
      expect(
        suggestedQuantity({ par: '40', balance: '-6', inTransit: '0', requisitionUnit: null }),
      ).toBe('46');
      expect(
        suggestedQuantity({ par: '40', balance: '-6', inTransit: '20', requisitionUnit: null }),
      ).toBe('26');
    });

    it('never goes below zero when the branch holds or awaits enough', () => {
      expect(
        suggestedQuantity({ par: '40', balance: '35', inTransit: '10', requisitionUnit: null }),
      ).toBe('0');
      expect(
        suggestedQuantity({ par: '40', balance: '40', inTransit: '0', requisitionUnit: null }),
      ).toBe('0');
    });

    it('rounds up to a whole requisition unit', () => {
      // A tray holds 12 pieces: 18 short is two trays.
      expect(
        suggestedQuantity({ par: '40', balance: '12', inTransit: '10', requisitionUnit: '12' }),
      ).toBe('24');
      // Exactly one tray short stays one tray.
      expect(
        suggestedQuantity({ par: '24', balance: '12', inTransit: '0', requisitionUnit: '12' }),
      ).toBe('12');
      // Weight, in 2.5 kg bags: 3.2 kg short is two bags.
      expect(
        suggestedQuantity({
          par: '10',
          balance: '5.3',
          inTransit: '1.5',
          requisitionUnit: '2.5',
        }),
      ).toBe('5');
      // Nothing short asks for nothing, whatever the unit.
      expect(
        suggestedQuantity({ par: '10', balance: '11', inTransit: '0', requisitionUnit: '12' }),
      ).toBe('0');
    });

    it('suggests nothing for an item with no par level at the branch', () => {
      expect(
        suggestedQuantity({ par: null, balance: '-3', inTransit: '0', requisitionUnit: null }),
      ).toBeNull();
    });

    it('rounds up exactly, with no floating point', () => {
      expect(formatMinimal(roundUpToMultiple(d('0.3'), d('0.1')))).toBe('0.3');
      expect(formatMinimal(roundUpToMultiple(d('0.301'), d('0.1')))).toBe('0.4');
      expect(() => roundUpToMultiple(d('1'), d('0'))).toThrow(RangeError);
    });
  });

  describe('lines', () => {
    const items = new Map([
      ['breast', { decimals: 0, active: true, requisitionUnit: '12' }],
      ['flour', { decimals: 3, active: true, requisitionUnit: null }],
      ['old', { decimals: 0, active: false, requisitionUnit: null }],
    ]);

    it('accepts one line per active item, in whole requisition units', () => {
      expect(
        linesProblem(
          [
            { itemId: 'breast', requested: '24' },
            { itemId: 'flour', requested: '2.5' },
          ],
          items,
        ),
      ).toBeNull();
    });

    it('refuses a repeated item, an inactive or unknown one, and a bad quantity', () => {
      expect(
        linesProblem(
          [
            { itemId: 'flour', requested: '1' },
            { itemId: 'flour', requested: '2' },
          ],
          items,
        ),
      ).toEqual({ code: 'DUPLICATE_ITEM', itemId: 'flour' });
      expect(linesProblem([{ itemId: 'old', requested: '1' }], items)).toEqual({
        code: 'INACTIVE_ITEM',
        itemId: 'old',
      });
      expect(linesProblem([{ itemId: 'nope', requested: '1' }], items)?.code).toBe('INACTIVE_ITEM');
      expect(linesProblem([{ itemId: 'flour', requested: '0' }], items)).toEqual({
        code: 'QUANTITY',
        itemId: 'flour',
        problem: 'NOT_POSITIVE',
      });
      expect(linesProblem([{ itemId: 'breast', requested: '1.5' }], items)).toEqual({
        code: 'QUANTITY',
        itemId: 'breast',
        problem: 'TOO_PRECISE',
      });
    });

    it('refuses a quantity that is not a whole number of requisition units', () => {
      expect(linesProblem([{ itemId: 'breast', requested: '20' }], items)).toEqual({
        code: 'NOT_A_MULTIPLE',
        itemId: 'breast',
        requisitionUnit: '12',
      });
      expect(isMultiple('36', '12')).toBe(true);
      expect(isMultiple('7.5', '2.5')).toBe(true);
      expect(isMultiple('7.6', '2.5')).toBe(false);
    });

    it('allows a par level of zero but nothing negative', () => {
      expect(quantityProblem('0', 0)).toBeNull();
      expect(quantityProblem('-1', 0)).toBe('NOT_POSITIVE');
      expect(quantityProblem('1.25', 1)).toBe('TOO_PRECISE');
    });
  });

  describe('fulfilment', () => {
    const line = (requested: string, dispatched: string, drafted = '0') => ({
      requested,
      dispatched,
      drafted,
    });

    it('keeps the stored status of a draft or cancelled requisition', () => {
      expect(requisitionStatus('draft', [line('10', '0')])).toBe('draft');
      expect(requisitionStatus('cancelled', [line('10', '0')])).toBe('cancelled');
    });

    it('follows what transfers dispatched, not what they plan', () => {
      expect(requisitionStatus('submitted', [line('10', '0', '10')])).toBe('submitted');
      expect(requisitionStatus('submitted', [line('10', '4'), line('5', '0')])).toBe(
        'partially_fulfilled',
      );
      expect(requisitionStatus('submitted', [line('10', '10'), line('5', '6')])).toBe('fulfilled');
      expect(requisitionStatus('submitted', [line('10', '10'), line('5', '4.999')])).toBe(
        'partially_fulfilled',
      );
    });

    it('leaves outstanding what is neither dispatched nor already planned', () => {
      expect(outstanding(line('20', '8', '5'))).toBe('7');
      expect(outstanding(line('20', '8', '20'))).toBe('0');
      expect(outstanding(line('20', '25'))).toBe('0');
      expect(undispatched({ requested: '20', dispatched: '8' })).toBe('12');
      expect(undispatched({ requested: '20', dispatched: '21' })).toBe('0');
    });
  });

  describe('steps', () => {
    it('edits and submits a draft only', () => {
      expect(stepAllowed('draft', 'edit')).toBe(true);
      expect(stepAllowed('submitted', 'edit')).toBe(false);
      expect(stepAllowed('draft', 'submit')).toBe(true);
      expect(stepAllowed('submitted', 'submit')).toBe(false);
    });

    it('cancels only before anything was dispatched', () => {
      expect(stepAllowed('draft', 'cancel')).toBe(true);
      expect(stepAllowed('submitted', 'cancel')).toBe(true);
      expect(stepAllowed('partially_fulfilled', 'cancel')).toBe(false);
      expect(stepAllowed('fulfilled', 'cancel')).toBe(false);
      expect(stepAllowed('cancelled', 'cancel')).toBe(false);
    });

    it('fulfils a submitted or partly fulfilled requisition', () => {
      expect(stepAllowed('submitted', 'fulfil')).toBe(true);
      expect(stepAllowed('partially_fulfilled', 'fulfil')).toBe(true);
      expect(stepAllowed('draft', 'fulfil')).toBe(false);
      expect(stepAllowed('fulfilled', 'fulfil')).toBe(false);
    });

    it('submits a requisition with lines, needed no earlier than today', () => {
      expect(submitProblem({ lineCount: 0, neededBy: '2026-10-12', today: '2026-10-11' })).toBe(
        'EMPTY_REQUISITION',
      );
      expect(submitProblem({ lineCount: 2, neededBy: '2026-10-10', today: '2026-10-11' })).toBe(
        'NEEDED_BY_PASSED',
      );
      expect(
        submitProblem({ lineCount: 2, neededBy: '2026-10-11', today: '2026-10-11' }),
      ).toBeNull();
    });
  });

  describe('par misses', () => {
    const base = {
      status: 'partially_fulfilled' as const,
      neededBy: '2026-10-10',
      today: '2026-10-12',
      requested: '20',
      dispatchedByNeededBy: '12',
    };

    it('counts a line short of what was requested by its needed-by date', () => {
      expect(lineMissed(base)).toBe(true);
      expect(lineMissed({ ...base, dispatchedByNeededBy: '20' })).toBe(false);
    });

    it('does not judge a line before its date has passed, nor a cancelled or draft one', () => {
      expect(lineMissed({ ...base, today: '2026-10-10' })).toBe(false);
      expect(lineMissed({ ...base, status: 'cancelled' })).toBe(false);
      expect(lineMissed({ ...base, status: 'draft' })).toBe(false);
    });
  });
});

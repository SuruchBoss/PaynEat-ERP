// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  applyMovements,
  businessDateProblem,
  lockOrder,
  lotNumber,
  netChanges,
  reversalMovements,
  reversalProblem,
  type Balance,
  type LocationType,
  type Movement,
  type ReversibleDocument,
} from './posting-rules';

const PLANT = 'loc-plant';
const BRANCH = 'loc-branch';
const WAREHOUSE = 'loc-warehouse';
const TRANSIT = 'loc-transit';
const types = new Map<string, LocationType>([
  [PLANT, 'plant'],
  [BRANCH, 'branch'],
  [WAREHOUSE, 'warehouse'],
  [TRANSIT, 'in_transit'],
]);

const move = (overrides: Partial<Movement>): Movement => ({
  lineNo: 1,
  lotId: 'lot-a',
  itemId: 'item-chicken',
  locationId: PLANT,
  quantity: '1',
  secondaryQuantity: null,
  unitCost: '72.5',
  ...overrides,
});

const balance = (overrides: Partial<Balance>): Balance => ({
  lotId: 'lot-a',
  itemId: 'item-chicken',
  locationId: PLANT,
  quantity: '0',
  secondaryQuantity: null,
  ...overrides,
});

describe('ledger posting rules', () => {
  describe('lock order', () => {
    it('locks by lot, then location, whatever order the document lists them in', () => {
      const rows = [
        { lotId: 'b', locationId: '2' },
        { lotId: 'a', locationId: '9' },
        { lotId: 'b', locationId: '1' },
        { lotId: 'a', locationId: '1' },
      ];
      expect(lockOrder(rows)).toEqual([
        { lotId: 'a', locationId: '1' },
        { lotId: 'a', locationId: '9' },
        { lotId: 'b', locationId: '1' },
        { lotId: 'b', locationId: '2' },
      ]);
      expect(rows[0]).toEqual({ lotId: 'b', locationId: '2' });
    });
  });

  describe('net changes', () => {
    it('adds the movements of one lot at one location together, exactly', () => {
      expect(
        netChanges([
          move({ quantity: '0.1', secondaryQuantity: '1' }),
          move({ quantity: '0.2', secondaryQuantity: '2' }),
          move({ lotId: 'lot-0', quantity: '5' }),
        ]),
      ).toEqual([
        balance({ lotId: 'lot-0', quantity: '5' }),
        balance({ quantity: '0.3', secondaryQuantity: '3' }),
      ]);
    });
  });

  describe('applying movements', () => {
    it('adds to what is there and creates what is not', () => {
      const result = applyMovements(
        [balance({ quantity: '21.6', secondaryQuantity: '12' })],
        [
          move({ quantity: '-1.8', secondaryQuantity: '-1' }),
          move({ lotId: 'lot-b', quantity: '10' }),
        ],
        types,
      );
      expect(result).toEqual({
        ok: true,
        balances: [
          balance({ quantity: '19.8', secondaryQuantity: '11' }),
          balance({ lotId: 'lot-b', quantity: '10' }),
        ],
        negativeAtBranch: [],
      });
    });

    it.each([
      [PLANT, 'negative_stock_plant'],
      [WAREHOUSE, 'negative_stock_warehouse'],
      [TRANSIT, 'negative_stock_in_transit'],
    ])('never takes a lot below zero at %s', (locationId, rule) => {
      const result = applyMovements(
        [balance({ locationId, quantity: '1.000' })],
        [move({ locationId, quantity: '-1.001' })],
        types,
      );
      expect(result).toEqual({
        ok: false,
        rule,
        lotId: 'lot-a',
        locationId,
        quantity: '-0.001',
      });
    });

    it('lets a lot reach exactly zero', () => {
      const result = applyMovements(
        [balance({ quantity: '1.000' })],
        [move({ quantity: '-1' })],
        types,
      );
      expect(result.ok && result.balances[0].quantity).toBe('0');
    });

    it('lets a branch go negative, and flags it', () => {
      const result = applyMovements(
        [balance({ locationId: BRANCH, quantity: '2' })],
        [move({ locationId: BRANCH, quantity: '-3' })],
        types,
      );
      expect(result).toEqual({
        ok: true,
        balances: [balance({ locationId: BRANCH, quantity: '-1' })],
        negativeAtBranch: [balance({ locationId: BRANCH, quantity: '-1' })],
      });
    });

    it('judges a document by its net effect on each lot', () => {
      const result = applyMovements(
        [balance({ quantity: '1' })],
        [move({ quantity: '-2' }), move({ quantity: '1.5' })],
        types,
      );
      expect(result.ok && result.balances[0].quantity).toBe('0.5');
    });
  });

  describe('reversal', () => {
    it('negates every entry exactly, keeping lot, location and cost', () => {
      expect(
        reversalMovements([
          {
            id: 'e1',
            lineNo: 1,
            lotId: 'lot-a',
            itemId: 'item-chicken',
            locationId: PLANT,
            quantity: '21.600',
            secondaryQuantity: '12',
            unitCost: '72.500000',
          },
          {
            id: 'e2',
            lineNo: 2,
            lotId: 'lot-b',
            itemId: 'item-flour',
            locationId: PLANT,
            quantity: '-0.013',
            secondaryQuantity: null,
            unitCost: '32.5',
          },
        ]),
      ).toEqual([
        move({
          quantity: '-21.6',
          secondaryQuantity: '-12',
          unitCost: '72.500000',
          reversesEntryId: 'e1',
        }),
        move({
          lineNo: 2,
          lotId: 'lot-b',
          itemId: 'item-flour',
          quantity: '0.013',
          unitCost: '32.5',
          reversesEntryId: 'e2',
        }),
      ]);
    });

    const posted: ReversibleDocument = {
      type: 'opening_balance',
      status: 'posted',
      businessDate: '2026-09-20',
      reversedBy: null,
    };

    it('reverses a posted document once, dated between its business date and today', () => {
      expect(reversalProblem(posted, '2026-09-20', '2026-09-26')).toBeNull();
      expect(reversalProblem(posted, '2026-09-26', '2026-09-26')).toBeNull();
      expect(reversalProblem(posted, '2026-09-19', '2026-09-26')).toBe(
        'business_date_before_original',
      );
      expect(reversalProblem(posted, '2026-09-27', '2026-09-26')).toBe('business_date_in_future');
    });

    it('never reverses a draft, a reversal, or a document already reversed', () => {
      expect(reversalProblem({ ...posted, status: 'draft' }, '2026-09-26', '2026-09-26')).toBe(
        'not_posted',
      );
      expect(reversalProblem({ ...posted, type: 'reversal' }, '2026-09-26', '2026-09-26')).toBe(
        'reversal_of_reversal',
      );
      expect(
        reversalProblem({ ...posted, reversedBy: 'RV-2026-00001' }, '2026-09-26', '2026-09-26'),
      ).toBe('already_reversed');
    });
  });

  it('refuses a business date later than today', () => {
    expect(businessDateProblem('2026-09-26', '2026-09-26')).toBeNull();
    expect(businessDateProblem('2025-12-31', '2026-09-26')).toBeNull();
    expect(businessDateProblem('2026-09-27', '2026-09-26')).toBe('business_date_in_future');
  });

  it('numbers a lot after its origin document and line', () => {
    expect(lotNumber('OB-2026-00001', 2)).toBe('OB-2026-00001/2');
  });
});

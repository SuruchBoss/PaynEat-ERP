// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { allocateAtBranch, consumedQuantity, saleTimeDecision } from './consumption-rules';

/** Thighs at Silom: an older tray, a newer tray, and one that expired yesterday. */
const lots = [
  { lotId: 'new', number: 'TR-2026-00002/1', expiryDate: '2026-10-13', available: '10' },
  { lotId: 'old', number: 'TR-2026-00001/1', expiryDate: '2026-10-11', available: '4' },
  { lotId: 'gone', number: 'OB-2026-00001/3', expiryDate: '2026-10-09', available: '6' },
];
const lastReceived = { lotId: 'new', number: 'TR-2026-00002/1', expiryDate: '2026-10-13' };

describe('branch consumption rules (#17)', () => {
  it('takes the earliest-expiring usable lot first, and never an expired one', () => {
    expect(allocateAtBranch(lots, '6', '2026-10-10', lastReceived)).toEqual({
      picks: [
        {
          lotId: 'old',
          number: 'TR-2026-00001/1',
          quantity: '4',
          shortfall: false,
          expired: false,
        },
        {
          lotId: 'new',
          number: 'TR-2026-00002/1',
          quantity: '2',
          shortfall: false,
          expired: false,
        },
      ],
      toPlaceholder: '0',
    });
  });

  it('takes what the lots cannot cover from the lot received most recently', () => {
    // 14 usable, 17 sold: the newest tray takes its 10 and the 3 short besides, so it goes to -3.
    expect(allocateAtBranch(lots, '17', '2026-10-10', lastReceived)).toEqual({
      picks: [
        {
          lotId: 'old',
          number: 'TR-2026-00001/1',
          quantity: '4',
          shortfall: false,
          expired: false,
        },
        {
          lotId: 'new',
          number: 'TR-2026-00002/1',
          quantity: '13',
          shortfall: true,
          expired: false,
        },
      ],
      toPlaceholder: '0',
    });
  });

  it('takes the shortfall from the last lot received even when it is used up or expired', () => {
    // Nothing usable on 14 October: the newest tray expired yesterday and holds nothing.
    const empty = [{ ...lots[0], available: '0' }];
    expect(allocateAtBranch(empty, '2', '2026-10-14', lastReceived)).toEqual({
      picks: [
        { lotId: 'new', number: 'TR-2026-00002/1', quantity: '2', shortfall: true, expired: true },
      ],
      toPlaceholder: '0',
    });
  });

  it('sends the shortfall to the placeholder when the branch never held the item', () => {
    expect(allocateAtBranch([], '0.25', '2026-10-10', null)).toEqual({
      picks: [],
      toPlaceholder: '0.25',
    });
  });

  it('rounds a usage once, half away from zero, to the base unit (ADR-0019)', () => {
    expect(consumedQuantity('0.0125', 3)).toBe('0.013');
    expect(consumedQuantity('0.12', 3)).toBe('0.12');
    expect(consumedQuantity('1.5', 0)).toBe('2');
    expect(consumedQuantity('0.0004', 3)).toBeNull();
  });

  it('processes a sale whose day has come, waits for one a little ahead, holds one far ahead', () => {
    const base = {
      receivedAt: new Date('2026-10-10T16:59:00Z'),
      today: '2026-10-10',
      toleranceSeconds: 600,
      reviewed: false,
    };
    // 23:59 Bangkok time, received a minute later by the ERP's clock: an ordinary sale.
    expect(
      saleTimeDecision({
        ...base,
        saleTime: new Date('2026-10-10T16:59:30Z'),
        saleDate: '2026-10-10',
      }),
    ).toBe('process');
    // Two minutes past midnight on a tablet two minutes fast: within tolerance, waits for its day.
    expect(
      saleTimeDecision({
        ...base,
        saleTime: new Date('2026-10-10T17:02:00Z'),
        saleDate: '2026-10-11',
      }),
    ).toBe('wait');
    // A year ahead: held, never posted into next year.
    expect(
      saleTimeDecision({
        ...base,
        saleTime: new Date('2027-10-10T09:00:00Z'),
        saleDate: '2027-10-10',
      }),
    ).toBe('hold');
    // Once a person re-processes it, it only waits for its day.
    expect(
      saleTimeDecision({
        ...base,
        reviewed: true,
        saleTime: new Date('2027-10-10T09:00:00Z'),
        saleDate: '2027-10-10',
      }),
    ).toBe('wait');
    // A late sale from last week is processed: late is not ahead.
    expect(
      saleTimeDecision({
        ...base,
        saleTime: new Date('2026-10-03T05:00:00Z'),
        saleDate: '2026-10-03',
      }),
    ).toBe('process');
  });
});

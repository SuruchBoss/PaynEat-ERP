// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { compareLotNumbers, fefoOrder, fefoPick, isExpired, type FefoLot } from './fefo';

const lot = (number: string, expiryDate: string, available: string): FefoLot => ({
  lotId: `id-${number}`,
  number,
  expiryDate,
  available,
});

describe('FEFO picking', () => {
  const today = '2026-10-10';

  it('takes the earliest expiry first, across as many lots as it needs', () => {
    const lots = [
      lot('GR-2026-00002/1', '2026-10-14', '384'),
      lot('GR-2026-00001/1', '2026-10-13', '238.4'),
    ];
    expect(fefoPick(lots, '300', today)).toEqual({
      picks: [
        {
          lotId: 'id-GR-2026-00001/1',
          number: 'GR-2026-00001/1',
          expiryDate: '2026-10-13',
          quantity: '238.4',
        },
        {
          lotId: 'id-GR-2026-00002/1',
          number: 'GR-2026-00002/1',
          expiryDate: '2026-10-14',
          quantity: '61.6',
        },
      ],
      shortBy: '0',
    });
  });

  it('never picks an expired lot, and a lot expiring today is still usable', () => {
    const lots = [
      lot('OB-2026-00001/1', '2026-10-09', '50'),
      lot('OB-2026-00001/2', '2026-10-10', '5'),
    ];
    expect(isExpired('2026-10-09', today)).toBe(true);
    expect(isExpired('2026-10-10', today)).toBe(false);
    expect(fefoPick(lots, '20', today)).toEqual({
      picks: [
        {
          lotId: 'id-OB-2026-00001/2',
          number: 'OB-2026-00001/2',
          expiryDate: '2026-10-10',
          quantity: '5',
        },
      ],
      shortBy: '15',
    });
  });

  it('skips lots with nothing left and reports what it could not cover', () => {
    const lots = [
      lot('A/1', '2026-10-11', '0'),
      lot('A/2', '2026-10-12', '-3'),
      lot('A/3', '2026-10-13', '2'),
    ];
    expect(fefoPick(lots, '5', today)).toEqual({
      picks: [{ lotId: 'id-A/3', number: 'A/3', expiryDate: '2026-10-13', quantity: '2' }],
      shortBy: '3',
    });
    expect(fefoPick([], '1', today)).toEqual({ picks: [], shortBy: '1' });
    expect(fefoPick(lots, '0', today)).toEqual({ picks: [], shortBy: '0' });
  });

  it('breaks ties on expiry by lot number, lines compared as numbers, whatever the input order', () => {
    const lots = [
      lot('GR-2026-00001/10', '2026-10-12', '1'),
      lot('GR-2026-00002/1', '2026-10-12', '1'),
      lot('GR-2026-00001/9', '2026-10-12', '1'),
    ];
    const order = ['GR-2026-00001/9', 'GR-2026-00001/10', 'GR-2026-00002/1'];
    expect(fefoOrder(lots).map((l) => l.number)).toEqual(order);
    expect(fefoOrder([...lots].reverse()).map((l) => l.number)).toEqual(order);
    expect(compareLotNumbers('A/2', 'A/2')).toBe(0);
  });

  it('keeps exact decimals, never a float', () => {
    const lots = [lot('A/1', '2026-10-11', '0.1'), lot('A/2', '2026-10-12', '0.2')];
    expect(fefoPick(lots, '0.3', today).picks.map((p) => p.quantity)).toEqual(['0.1', '0.2']);
  });

  it('refuses a quantity below zero', () => {
    expect(() => fefoPick([], '-1', today)).toThrow(RangeError);
  });
});

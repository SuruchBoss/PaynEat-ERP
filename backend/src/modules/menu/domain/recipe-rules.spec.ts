// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  hasTakenEffect,
  moneyProblem,
  newVersionProblem,
  priceInEffect,
  recipeCost,
  recipeInEffect,
  recipeLineIssues,
  theoreticalUsage,
} from './recipe-rules';

const V1 = { number: 1, effectiveFrom: '2026-09-01' };
const V2 = { number: 2, effectiveFrom: '2026-10-01' };
const V3 = { number: 3, effectiveFrom: '2026-11-15' };

describe('recipe in effect at a date', () => {
  // Out of order on purpose: the answer never depends on the order versions arrive in.
  const versions = [V3, V1, V2];

  it('is none before the first version starts', () => {
    expect(recipeInEffect(versions, '2026-08-31')).toBeNull();
    expect(recipeInEffect([], '2026-10-01')).toBeNull();
  });

  it('switches on the effective-from day itself, not the day after', () => {
    expect(recipeInEffect(versions, '2026-09-01')).toBe(V1);
    expect(recipeInEffect(versions, '2026-09-30')).toBe(V1);
    expect(recipeInEffect(versions, '2026-10-01')).toBe(V2);
    expect(recipeInEffect(versions, '2026-11-14')).toBe(V2);
    expect(recipeInEffect(versions, '2026-11-15')).toBe(V3);
  });

  it('keeps the last version in force with no end date', () => {
    expect(recipeInEffect(versions, '2030-01-01')).toBe(V3);
  });

  it('crosses a year boundary like any other day', () => {
    const turn = [{ effectiveFrom: '2026-12-31' }, { effectiveFrom: '2027-01-01' }];
    expect(recipeInEffect(turn, '2026-12-31')).toBe(turn[0]);
    expect(recipeInEffect(turn, '2027-01-01')).toBe(turn[1]);
  });

  it('says a version has taken effect from its first day on', () => {
    expect(hasTakenEffect(V2, '2026-09-30')).toBe(false);
    expect(hasTakenEffect(V2, '2026-10-01')).toBe(true);
    expect(hasTakenEffect(V2, '2026-10-02')).toBe(true);
  });
});

describe('a new recipe version', () => {
  it('may start today when no version is in force yet', () => {
    expect(newVersionProblem([], '2026-10-02', '2026-10-02')).toBeNull();
    expect(newVersionProblem([V3], '2026-10-02', '2026-10-02')).toBeNull();
  });

  it('starts tomorrow at the earliest once a version is in force', () => {
    expect(newVersionProblem([V1], '2026-10-02', '2026-10-02')).toEqual({
      reason: 'too_early',
      earliest: '2026-10-03',
    });
    expect(newVersionProblem([V1], '2026-10-03', '2026-10-02')).toBeNull();
  });

  it('never starts in the past', () => {
    expect(newVersionProblem([], '2026-10-01', '2026-10-02')).toEqual({
      reason: 'too_early',
      earliest: '2026-10-02',
    });
  });

  it('is refused on a day another version already starts on', () => {
    expect(newVersionProblem([V1, V3], '2026-11-15', '2026-10-02')).toEqual({
      reason: 'overlap',
    });
  });

  it('may start between two versions that have not both taken effect', () => {
    expect(newVersionProblem([V1, V3], '2026-11-01', '2026-10-02')).toBeNull();
  });
});

describe('price in effect at a branch', () => {
  const prices = [
    { id: 'chain-old', locationCode: null, effectiveFrom: '2026-09-01' },
    { id: 'chain-new', locationCode: null, effectiveFrom: '2026-10-15' },
    { id: 'silom', locationCode: 'BR-SILOM', effectiveFrom: '2026-10-01' },
  ];

  it('is the branch override once it starts, and the chain price elsewhere', () => {
    expect(priceInEffect(prices, 'BR-SILOM', '2026-09-30')?.id).toBe('chain-old');
    expect(priceInEffect(prices, 'BR-SILOM', '2026-10-01')?.id).toBe('silom');
    expect(priceInEffect(prices, 'BR-ARI', '2026-10-01')?.id).toBe('chain-old');
  });

  it('keeps the branch override even after a later chain-wide change', () => {
    expect(priceInEffect(prices, 'BR-SILOM', '2026-10-20')?.id).toBe('silom');
    expect(priceInEffect(prices, 'BR-ARI', '2026-10-20')?.id).toBe('chain-new');
    expect(priceInEffect(prices, null, '2026-10-20')?.id).toBe('chain-new');
  });

  it('is none before any price starts', () => {
    expect(priceInEffect(prices, 'BR-ARI', '2026-08-31')).toBeNull();
  });
});

describe('recipe lines', () => {
  const items = new Map([
    ['chicken', { active: true, baseUnitDecimals: 3 }],
    ['wing', { active: true, baseUnitDecimals: 0 }],
    ['old', { active: false, baseUnitDecimals: 3 }],
  ]);

  it('accepts real quantities in the base unit', () => {
    expect(
      recipeLineIssues(
        'menu',
        [
          { itemId: 'chicken', quantity: '1.25' },
          { itemId: 'wing', quantity: '2' },
        ],
        items,
      ),
    ).toEqual([]);
  });

  it('reports every bad line by its number', () => {
    expect(
      recipeLineIssues(
        'menu',
        [
          { itemId: 'nobody', quantity: '1' },
          { itemId: 'old', quantity: '1' },
          { itemId: 'chicken', quantity: '0' },
          { itemId: 'chicken', quantity: '1' },
          { itemId: 'wing', quantity: '0.5' },
        ],
        items,
      ),
    ).toEqual([
      { lineNo: 1, problem: 'unknown_item' },
      { lineNo: 2, problem: 'inactive_item' },
      { lineNo: 3, problem: 'not_positive' },
      { lineNo: 4, problem: 'duplicate_item' },
      { lineNo: 5, problem: 'too_many_decimals' },
    ]);
  });

  it('lets a modifier recipe remove an item, but not leave a line at nothing', () => {
    expect(recipeLineIssues('modifier', [{ itemId: 'wing', quantity: '-1' }], items)).toEqual([]);
    expect(recipeLineIssues('modifier', [{ itemId: 'wing', quantity: '0' }], items)).toEqual([
      { lineNo: 1, problem: 'zero' },
    ]);
    expect(recipeLineIssues('menu', [{ itemId: 'wing', quantity: '-1' }], items)).toEqual([
      { lineNo: 1, problem: 'not_positive' },
    ]);
  });

  it('refuses a quantity that is not plain decimal notation', () => {
    expect(recipeLineIssues('menu', [{ itemId: 'chicken', quantity: '1e3' }], items)).toEqual([
      { lineNo: 1, problem: 'not_a_decimal' },
    ]);
  });
});

describe('theoretical usage of a sale line', () => {
  const twoPiece = [
    { itemId: 'drumstick', quantity: '1' },
    { itemId: 'thigh', quantity: '1' },
    { itemId: 'sauce', quantity: '1' },
    { itemId: 'flour', quantity: '0.06' },
  ];
  const spicy = [{ itemId: 'seasoning', quantity: '0.005' }];
  const noSauce = [{ itemId: 'sauce', quantity: '-1' }];

  it('is the menu recipe times the pieces sold', () => {
    expect(theoreticalUsage(twoPiece, [], '3')).toEqual(
      new Map([
        ['drumstick', '3'],
        ['thigh', '3'],
        ['sauce', '3'],
        ['flour', '0.18'],
      ]),
    );
  });

  it('adds option recipe × modifier quantity × line quantity', () => {
    const usage = theoreticalUsage(
      twoPiece,
      [
        { lines: spicy, quantity: '2' },
        { lines: noSauce, quantity: '1' },
      ],
      '3',
    );
    expect(usage.get('seasoning')).toBe('0.03');
    expect(usage.get('sauce')).toBe('0');
    expect(usage.get('drumstick')).toBe('3');
  });

  it('scales by weightKg for an item sold by weight', () => {
    const perKg = [
      { itemId: 'chicken', quantity: '1.25' },
      { itemId: 'oil', quantity: '0.08' },
    ];
    expect(theoreticalUsage(perKg, [{ lines: spicy, quantity: '1' }], '0.450')).toEqual(
      new Map([
        ['chicken', '0.5625'],
        ['oil', '0.036'],
        ['seasoning', '0.00225'],
      ]),
    );
  });
});

describe('theoretical cost of a portion', () => {
  it('is each quantity times its current lot cost, exactly', () => {
    expect(
      recipeCost([
        { quantity: '0.06', unitCost: '32.5' },
        { quantity: '1', unitCost: '14.5' },
      ]),
    ).toEqual({ lines: ['1.95', '14.5'], total: '16.45', complete: true });
  });

  it('says so when an item has no lot cost, rather than pricing it at zero', () => {
    expect(
      recipeCost([
        { quantity: '0.06', unitCost: '32.5' },
        { quantity: '1', unitCost: null },
      ]),
    ).toEqual({ lines: ['1.95', null], total: '1.95', complete: false });
  });
});

describe('money', () => {
  it('is baht with satang at most', () => {
    expect(moneyProblem('59', false)).toBeNull();
    expect(moneyProblem('59.50', false)).toBeNull();
    expect(moneyProblem('59.505', false)).toBe('too_many_decimals');
    expect(moneyProblem('fifty', false)).toBe('not_a_decimal');
    expect(moneyProblem('123456789', false)).toBe('too_large');
  });

  it('is never negative for a menu price, but may be for an option price change', () => {
    expect(moneyProblem('-5', false)).toBe('negative');
    expect(moneyProblem('-5', true)).toBeNull();
  });
});

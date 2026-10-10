// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { saleUsage, type SaleLine, type SaleMenuItem, type SaleModifierOption } from './sale-usage';

const active = new Set(['THIGH', 'DRUMSTICK', 'BATTER', 'SAUCE', 'RICE', 'SKIN']);

/** Two pieces of fried chicken and batter; from 15 October the set gets a second scoop of rice. */
const set: SaleMenuItem = {
  id: 'm-set',
  code: 'SET-2PC',
  soldBy: 'portion',
  recipes: [
    {
      effectiveFrom: '2026-10-01',
      lines: [
        { itemId: 'THIGH', quantity: '1' },
        { itemId: 'DRUMSTICK', quantity: '1' },
        { itemId: 'BATTER', quantity: '0.06' },
        { itemId: 'RICE', quantity: '0.15' },
      ],
    },
    {
      effectiveFrom: '2026-10-15',
      lines: [
        { itemId: 'THIGH', quantity: '1' },
        { itemId: 'DRUMSTICK', quantity: '1' },
        { itemId: 'BATTER', quantity: '0.06' },
        { itemId: 'RICE', quantity: '0.3' },
      ],
    },
  ],
};

/** Chicken skin sold by the kilogram: per kilogram sold it uses 1.1 kg of raw skin and 0.05 kg batter. */
const skin: SaleMenuItem = {
  id: 'm-skin',
  code: 'SKIN-KG',
  soldBy: 'weight',
  recipes: [
    {
      effectiveFrom: '2026-10-01',
      lines: [
        { itemId: 'SKIN', quantity: '1.1' },
        { itemId: 'BATTER', quantity: '0.05' },
      ],
    },
  ],
};

const options = new Map<string, SaleModifierOption>([
  // Extra sauce: 0.03 kg of sauce per unit sold.
  [
    'EXTRA-SAUCE',
    {
      id: 'o1',
      code: 'EXTRA-SAUCE',
      recipes: [{ effectiveFrom: '2026-10-01', lines: [{ itemId: 'SAUCE', quantity: '0.03' }] }],
    },
  ],
  // No rice: takes the set's rice away again.
  [
    'NO-RICE',
    {
      id: 'o2',
      code: 'NO-RICE',
      recipes: [{ effectiveFrom: '2026-10-01', lines: [{ itemId: 'RICE', quantity: '-0.15' }] }],
    },
  ],
  // Extra spicy: changes nothing the stock sees.
  ['SPICY', { id: 'o3', code: 'SPICY', recipes: [] }],
]);

const line = (overrides: Partial<SaleLine>): SaleLine => ({
  menuItemCode: 'SET-2PC',
  quantity: '2',
  weightKg: null,
  modifiers: [],
  saleDate: '2026-10-10',
  ...overrides,
});

const usageOf = (result: ReturnType<typeof saleUsage>) => {
  if (!result.ok) throw new Error(`expected usage, got ${result.reason}`);
  return Object.fromEntries(result.usage);
};

describe('sale usage (#17)', () => {
  it('explodes two two-piece sets into their ingredients', () => {
    const result = saleUsage(line({}), set, options, active);
    expect(usageOf(result)).toEqual({ THIGH: '2', DRUMSTICK: '2', BATTER: '0.12', RICE: '0.3' });
    expect(result.ok && result.menuRecipeEffectiveFrom).toBe('2026-10-01');
  });

  it('uses the weight for an item sold by the kilogram, and a modifier per kilogram sold', () => {
    // 0.4 kg sold with extra sauce: skin 1.1 × 0.4, batter 0.05 × 0.4, sauce 0.03 × 1 × 0.4.
    const result = saleUsage(
      line({
        menuItemCode: 'SKIN-KG',
        quantity: null,
        weightKg: '0.4',
        modifiers: [{ code: 'EXTRA-SAUCE', quantity: '1' }],
      }),
      skin,
      options,
      active,
    );
    expect(usageOf(result)).toEqual({ SKIN: '0.44', BATTER: '0.02', SAUCE: '0.012' });
  });

  it('adds what a modifier adds and removes what one removes, per unit sold', () => {
    // Three sets, two portions of extra sauce on each, no rice: sauce 0.03 × 2 × 3, rice gone.
    const result = saleUsage(
      line({
        quantity: '3',
        modifiers: [
          { code: 'EXTRA-SAUCE', quantity: '2' },
          { code: 'NO-RICE', quantity: '1' },
          { code: 'SPICY', quantity: '1' },
        ],
      }),
      set,
      options,
      active,
    );
    expect(usageOf(result)).toEqual({ THIGH: '3', DRUMSTICK: '3', BATTER: '0.18', SAUCE: '0.18' });
  });

  it('uses the version in force on the sale date, and the new one from the day it starts', () => {
    expect(usageOf(saleUsage(line({ saleDate: '2026-10-14' }), set, options, active)).RICE).toBe(
      '0.3',
    );
    const onBoundary = saleUsage(line({ saleDate: '2026-10-15' }), set, options, active);
    expect(usageOf(onBoundary).RICE).toBe('0.6');
    expect(onBoundary.ok && onBoundary.menuRecipeEffectiveFrom).toBe('2026-10-15');
  });

  it('says why a sale line cannot become consumption', () => {
    expect(saleUsage(line({}), null, options, active)).toEqual({
      ok: false,
      reason: 'unknown_menu_item',
    });
    expect(
      saleUsage(line({ modifiers: [{ code: 'GHOST', quantity: '1' }] }), set, options, active),
    ).toEqual({ ok: false, reason: 'unknown_modifier', code: 'GHOST' });
    expect(saleUsage(line({ saleDate: '2026-09-30' }), set, options, active)).toEqual({
      ok: false,
      reason: 'no_recipe_in_effect',
    });
    expect(saleUsage(line({ quantity: null, weightKg: '0.5' }), set, options, active)).toEqual({
      ok: false,
      reason: 'sold_by_mismatch',
    });
    expect(saleUsage(line({}), set, options, new Set(['THIGH', 'DRUMSTICK', 'BATTER']))).toEqual({
      ok: false,
      reason: 'inactive_ingredient',
      itemId: 'RICE',
    });
    expect(
      saleUsage(line({ modifiers: [{ code: 'NO-RICE', quantity: '2' }] }), set, options, active),
    ).toEqual({ ok: false, reason: 'negative_usage', itemId: 'RICE' });
  });
});

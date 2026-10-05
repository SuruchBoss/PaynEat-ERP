// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The menu in the demo (#16, ADR-0021), read only: menu items, prices, modifier groups and
 * recipe versions built from the backend's demo data, with dates counted from today as the
 * seed counts them and each recipe priced at the demo's current lot costs by the backend's own
 * `recipeCost`. Changing the menu answers NOT_IN_DEMO, as ADR-0021 allows: the server routes
 * only these reads.
 */
import { addDays, compareDates, dateIn } from '@backend/src/core/time/domain/business-date';
import {
  normalise,
  priceInEffect,
  recipeCost,
  recipeInEffect,
} from '@backend/src/modules/menu/domain/recipe-rules';
import type { DemoRecipeVersion } from '@backend/prisma/demo-data';
import { notFound, uuidParam, type Context } from './http';
import { DEMO_MENU_ITEMS, DEMO_MODIFIER_GROUPS } from './seed';
import { DEMO_TIME_ZONE, seedId, type DemoState } from './state';
import { currentLotCosts } from './stock';

const KIND = { menuItem: 8, group: 9, option: 10, recipe: 11, price: 12 };

type Timing = 'current' | 'scheduled' | 'past';

const dayOf = (now: number) => dateIn(DEMO_TIME_ZONE, new Date(now));

function timing(effectiveFrom: string, inForce: boolean, today: string): Timing {
  if (inForce) return 'current';
  return compareDates(effectiveFrom, today) > 0 ? 'scheduled' : 'past';
}

/** The demo's modifier groups, ids fixed, options in order. */
function groups() {
  let optionIndex = 0;
  return DEMO_MODIFIER_GROUPS.map((group, index) => ({
    id: seedId(KIND.group, index),
    code: group.code,
    nameTh: group.nameTh,
    nameEn: group.nameEn,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    active: true,
    version: 1,
    options: group.options.map((option) => ({
      id: seedId(KIND.option, optionIndex++),
      code: option.code,
      nameTh: option.nameTh,
      nameEn: option.nameEn,
      priceChange: normalise(option.priceChange),
      active: true,
      recipes: option.recipes,
    })),
  }));
}

function menuItems(state: DemoState, today: string) {
  const groupByCode = new Map(groups().map((g) => [g.code, g]));
  const branchByCode = new Map(
    state.locations.filter((l) => l.type === 'branch').map((l) => [l.code, l]),
  );
  let priceIndex = 0;
  return DEMO_MENU_ITEMS.map((demo, index) => {
    const prices = demo.prices.map((p) => {
      const location = p.locationCode ? branchByCode.get(p.locationCode) : undefined;
      return {
        id: seedId(KIND.price, priceIndex++),
        location: location
          ? {
              id: location.id,
              code: location.code,
              nameTh: location.nameTh,
              nameEn: location.nameEn,
            }
          : null,
        locationCode: p.locationCode,
        effectiveFrom: addDays(today, p.fromDay),
        price: p.price === null ? null : normalise(p.price),
        version: 1,
      };
    });
    return {
      id: seedId(KIND.menuItem, index),
      code: demo.code,
      nameTh: demo.nameTh,
      nameEn: demo.nameEn,
      categoryTh: demo.categoryTh,
      categoryEn: demo.categoryEn,
      soldBy: demo.soldBy,
      active: true,
      modifierGroups: demo.modifierGroupCodes.map((code) => {
        const g = groupByCode.get(code)!;
        return { id: g.id, code: g.code, nameTh: g.nameTh, nameEn: g.nameEn };
      }),
      currentPrice: priceInEffect(prices, null, today)?.price ?? null,
      version: 1,
      prices,
      recipes: demo.recipes,
    };
  });
}

type MenuItem = ReturnType<typeof menuItems>[number];

function itemView({ prices: _prices, recipes: _recipes, ...item }: MenuItem) {
  return item;
}

function detailView(item: MenuItem, today: string) {
  const prices = item.prices
    .map((p) => {
      // The row in force within its own scope, as the backend's priceViews decides it: a
      // branch's return to the chain price is current while it is the branch's latest row.
      const scope = item.prices.filter((other) => other.locationCode === p.locationCode);
      const inForce = recipeInEffect(scope, today);
      const { locationCode: _code, ...view } = p;
      return { ...view, status: timing(p.effectiveFrom, inForce?.id === p.id, today) };
    })
    .sort(
      (a, b) =>
        compareDates(b.effectiveFrom, a.effectiveFrom) ||
        (a.location?.code ?? '').localeCompare(b.location?.code ?? ''),
    );
  return { ...itemView(item), prices };
}

function recipeView(
  state: DemoState,
  now: number,
  subject: { kind: 'menu' | 'modifier'; id: string; code: string; nameTh: string; nameEn: string },
  per: 'portion' | 'kg' | 'unit_sold',
  versions: readonly DemoRecipeVersion[],
  versionBase: number,
) {
  const today = dayOf(now);
  const costs = currentLotCosts(state, now);
  const itemByCode = new Map(state.items.map((i) => [i.code, i]));
  const dated = versions.map((v, index) => ({
    id: seedId(KIND.recipe, versionBase + index),
    number: index + 1,
    effectiveFrom: addDays(today, v.fromDay),
    lines: v.lines,
  }));
  const current = recipeInEffect(dated, today);
  return {
    subject: { ...subject, per },
    today,
    versions: dated
      .map((version) => {
        const lines = version.lines.map(([code, quantity], i) => {
          const item = itemByCode.get(code)!;
          const cost = costs.get(item.id);
          return {
            lineNo: i + 1,
            item: {
              id: item.id,
              code: item.code,
              nameTh: item.nameTh,
              nameEn: item.nameEn,
              baseUnitCode: item.baseUnitCode,
            },
            quantity: normalise(quantity),
            unitCost: cost?.unitCost ?? null,
            costLot: cost?.lotNumber ?? null,
          };
        });
        const priced = recipeCost(lines);
        return {
          id: version.id,
          number: version.number,
          effectiveFrom: version.effectiveFrom,
          status: timing(version.effectiveFrom, current?.id === version.id, today),
          lines: lines.map((line, i) => ({ ...line, cost: priced.lines[i] })),
          theoreticalCost: { total: priced.total, complete: priced.complete },
          version: 1,
        };
      })
      .reverse(),
  };
}

export function listMenuItems(state: DemoState, ctx: Context) {
  const status = ctx.query.get('status') ?? 'active';
  const q = ctx.query.get('q')?.trim().toLocaleLowerCase() ?? '';
  return menuItems(state, dayOf(ctx.now))
    .filter((item) => status === 'all' || item.active === (status === 'active'))
    .filter(
      (item) =>
        !q ||
        [item.code, item.nameTh, item.nameEn, item.categoryTh, item.categoryEn].some((s) =>
          s.toLocaleLowerCase().includes(q),
        ),
    )
    .map(itemView);
}

function findItem(state: DemoState, ctx: Context): MenuItem {
  const id = uuidParam(ctx.params[0]);
  const item = menuItems(state, dayOf(ctx.now)).find((m) => m.id === id);
  if (!item) throw notFound('MenuItem', id);
  return item;
}

export function getMenuItem(state: DemoState, ctx: Context) {
  return detailView(findItem(state, ctx), dayOf(ctx.now));
}

export function menuRecipe(state: DemoState, ctx: Context) {
  const item = findItem(state, ctx);
  const index = DEMO_MENU_ITEMS.findIndex((m) => m.code === item.code);
  return recipeView(
    state,
    ctx.now,
    { kind: 'menu', id: item.id, code: item.code, nameTh: item.nameTh, nameEn: item.nameEn },
    item.soldBy === 'weight' ? 'kg' : 'portion',
    item.recipes,
    index * 10,
  );
}

export function listModifierGroups() {
  return groups().map(({ options, ...group }) => ({
    ...group,
    options: options.map(({ recipes: _recipes, ...option }) => option),
  }));
}

export function getModifierGroup(_state: DemoState, ctx: Context) {
  const id = uuidParam(ctx.params[0]);
  const group = listModifierGroups().find((g) => g.id === id);
  if (!group) throw notFound('ModifierGroup', id);
  return group;
}

export function modifierRecipe(state: DemoState, ctx: Context) {
  const id = uuidParam(ctx.params[0]);
  const options = groups().flatMap((g) => g.options);
  const index = options.findIndex((o) => o.id === id);
  if (index < 0) throw notFound('ModifierOption', id);
  const option = options[index];
  return recipeView(
    state,
    ctx.now,
    { kind: 'modifier', id, code: option.code, nameTh: option.nameTh, nameEn: option.nameEn },
    'unit_sold',
    option.recipes,
    1000 + index * 10,
  );
}

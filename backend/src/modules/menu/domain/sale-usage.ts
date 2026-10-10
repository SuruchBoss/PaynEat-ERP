// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * What one sale line uses (#17, ADR-0002, ADR-0005, ADR-0023): the menu item's recipe and every
 * modifier option's recipe in force on the day of the sale, exploded into ingredient quantities
 * in each item's base unit. A modifier's quantity is per one unit sold on the line (per piece for
 * `quantity`, per kilogram for `weightKg`), so an option's usage is its recipe × the modifier's
 * quantity × the line's quantity or weight. No clock here: the caller passes the sale's business
 * date, and no grouping by bill: each sale line is exploded on its own.
 */
import { versionInEffect, type Dated } from '../../../core/time/domain/dated-versions';
import { sign, parseDecimal } from '../../../core/quantity/domain/exact-decimal';
import { theoreticalUsage, type RecipeLineInput } from './recipe-rules';

export interface SaleMenuItem {
  id: string;
  code: string;
  soldBy: 'portion' | 'weight';
  /** Its recipe versions; the one in force on the sale date is used. */
  recipes: ReadonlyArray<Dated & { lines: readonly RecipeLineInput[] }>;
}

export interface SaleModifierOption {
  id: string;
  code: string;
  /** Its recipe versions; an option with none in force on the sale date uses nothing. */
  recipes: ReadonlyArray<Dated & { lines: readonly RecipeLineInput[] }>;
}

export interface SaleLine {
  menuItemCode: string;
  /** Sold by count. Exactly one of `quantity` and `weightKg` is set (sales event v1). */
  quantity: string | null;
  /** Sold by weight, in kilograms. */
  weightKg: string | null;
  modifiers: ReadonlyArray<{ code: string; quantity: string }>;
  /** The sale's business date in the company's time zone (ADR-0018). */
  saleDate: string;
}

/** Why a sale line cannot become consumption: each is shown with the event and logged as `reason`. */
export type SaleUsageFailure =
  /** No menu item has the event's code. */
  | { reason: 'unknown_menu_item' }
  /** A modifier code no option has. */
  | { reason: 'unknown_modifier'; code: string }
  /** The menu item had no recipe in force on the sale date. */
  | { reason: 'no_recipe_in_effect' }
  /** A weight on an item sold by portion, or a quantity on one sold by weight. */
  | { reason: 'sold_by_mismatch' }
  /** A recipe in force uses an item that is no longer active. */
  | { reason: 'inactive_ingredient'; itemId: string }
  /** The options take an item below zero for the line: the recipes disagree with each other. */
  | { reason: 'negative_usage'; itemId: string };

export type SaleUsage =
  | {
      ok: true;
      /** The recipe versions used, for the record. */
      menuRecipeEffectiveFrom: string;
      /** Per item, in the item's base unit, exact; items the options cancel out are left out. */
      usage: Map<string, string>;
    }
  | ({ ok: false } & SaleUsageFailure);

/**
 * The ingredients one sale line uses, or why it cannot be worked out. Checked in the order a
 * person fixes them: the menu item, the modifiers, how it is sold, the recipe in force, then the
 * items the recipes use.
 */
export function saleUsage(
  line: SaleLine,
  menuItem: SaleMenuItem | null,
  options: ReadonlyMap<string, SaleModifierOption>,
  activeItems: ReadonlySet<string>,
): SaleUsage {
  if (!menuItem) return { ok: false, reason: 'unknown_menu_item' };
  for (const modifier of line.modifiers) {
    if (!options.has(modifier.code)) {
      return { ok: false, reason: 'unknown_modifier', code: modifier.code };
    }
  }
  const sold = menuItem.soldBy === 'weight' ? line.weightKg : line.quantity;
  const other = menuItem.soldBy === 'weight' ? line.quantity : line.weightKg;
  if (sold === null || other !== null) return { ok: false, reason: 'sold_by_mismatch' };

  const recipe = versionInEffect(menuItem.recipes, line.saleDate);
  if (!recipe) return { ok: false, reason: 'no_recipe_in_effect' };
  const modifiers = line.modifiers.map((modifier) => ({
    lines: versionInEffect(options.get(modifier.code)!.recipes, line.saleDate)?.lines ?? [],
    quantity: modifier.quantity,
  }));

  for (const used of [recipe.lines, ...modifiers.map((m) => m.lines)]) {
    for (const ingredient of used) {
      if (!activeItems.has(ingredient.itemId)) {
        return { ok: false, reason: 'inactive_ingredient', itemId: ingredient.itemId };
      }
    }
  }

  const usage = new Map<string, string>();
  for (const [itemId, quantity] of theoreticalUsage(recipe.lines, modifiers, sold)) {
    const value = parseDecimal(quantity)!;
    if (sign(value) < 0) return { ok: false, reason: 'negative_usage', itemId };
    if (sign(value) > 0) usage.set(itemId, quantity);
  }
  return { ok: true, menuRecipeEffectiveFrom: recipe.effectiveFrom, usage };
}

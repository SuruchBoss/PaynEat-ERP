// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Menu items, prices, modifier groups and recipes (backend `modules/menu/menu.controller.ts`, #16).
import { api } from '@/lib/api-client';

export type SoldBy = 'portion' | 'weight';
export type Timing = 'current' | 'scheduled' | 'past';

export interface Ref {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
}

export interface MenuPriceView {
  id: string;
  /** Null for the chain-wide price. */
  location: Ref | null;
  effectiveFrom: string;
  /** Null when a branch returns to the chain-wide price from `effectiveFrom` (ADR-0023). */
  price: string | null;
  status: Timing;
  version: number;
}

export interface MenuItemView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  categoryTh: string;
  categoryEn: string;
  soldBy: SoldBy;
  active: boolean;
  modifierGroups: Ref[];
  /** The chain-wide price in force today, or null when none has started. */
  currentPrice: string | null;
  version: number;
}

export interface MenuItemDetailView extends MenuItemView {
  prices: MenuPriceView[];
}

export interface MenuItemFields {
  nameTh: string;
  nameEn: string;
  categoryTh: string;
  categoryEn: string;
  modifierGroupIds: string[];
}

export interface NewMenuItem extends MenuItemFields {
  code: string;
  soldBy: SoldBy;
}

export type MenuItemChange = Partial<MenuItemFields> & { version: number; active?: boolean };

export interface NewPrice {
  /** A branch, or null for the chain-wide price. */
  locationId: string | null;
  effectiveFrom: string;
  /** Null only with a branch: from `effectiveFrom` the branch charges the chain-wide price again. */
  price: string | null;
}

export interface ModifierOptionView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  priceChange: string;
  active: boolean;
}

export interface ModifierGroupView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  minSelections: number;
  maxSelections: number;
  active: boolean;
  options: ModifierOptionView[];
  version: number;
}

export interface ModifierOptionInput {
  code: string;
  nameTh: string;
  nameEn: string;
  priceChange: string;
  active: boolean;
}

export interface NewModifierGroup {
  code: string;
  nameTh: string;
  nameEn: string;
  minSelections: number;
  maxSelections: number;
  options: ModifierOptionInput[];
}

export type ModifierGroupChange = Partial<Omit<NewModifierGroup, 'code'>> & {
  version: number;
  active?: boolean;
};

export interface RecipeLineInput {
  itemId: string;
  quantity: string;
}

export interface RecipeLineView {
  lineNo: number;
  item: Ref & { baseUnitCode: string };
  quantity: string;
  unitCost: string | null;
  costLot: string | null;
  cost: string | null;
}

export interface RecipeVersionView {
  id: string;
  number: number;
  effectiveFrom: string;
  status: Timing;
  lines: RecipeLineView[];
  /** An estimate at current lot costs (ADR-0023); a floor when `complete` is false. */
  theoreticalCost: { total: string; complete: boolean };
  version: number;
}

export type RecipeKind = 'menu' | 'modifier';

export interface RecipeView {
  subject: Ref & { kind: RecipeKind; per: 'portion' | 'kg' | 'unit_sold' };
  today: string;
  versions: RecipeVersionView[];
}

/** One recipe line the API refused, and why (backend `menu/domain/recipe-rules.ts`). */
export interface RecipeLineIssue {
  lineNo: number;
  problem: string;
}

const segment = encodeURIComponent;

/** Every menu item, active or not: the list filters on screen. */
export const listMenuItems = () =>
  api.get<MenuItemView[]>('/menu-items', { query: { status: 'all' } });

export const getMenuItem = (id: string) =>
  api.get<MenuItemDetailView>(`/menu-items/${segment(id)}`);

export const createMenuItem = (item: NewMenuItem) =>
  api.post<MenuItemDetailView>('/menu-items', item);

export const updateMenuItem = (id: string, change: MenuItemChange) =>
  api.patch<MenuItemDetailView>(`/menu-items/${segment(id)}`, change);

export const setMenuPrice = (id: string, price: NewPrice) =>
  api.post<MenuItemDetailView>(`/menu-items/${segment(id)}/prices`, price);

export const listModifierGroups = () => api.get<ModifierGroupView[]>('/modifier-groups');

export const createModifierGroup = (group: NewModifierGroup) =>
  api.post<ModifierGroupView>('/modifier-groups', group);

export const updateModifierGroup = (id: string, change: ModifierGroupChange) =>
  api.patch<ModifierGroupView>(`/modifier-groups/${segment(id)}`, change);

const recipeBase = (kind: RecipeKind, id: string) =>
  kind === 'menu' ? `/menu-items/${segment(id)}` : `/modifier-options/${segment(id)}`;

export const getRecipe = (kind: RecipeKind, id: string) =>
  api.get<RecipeView>(`${recipeBase(kind, id)}/recipe`);

export const addRecipeVersion = (
  kind: RecipeKind,
  id: string,
  version: { effectiveFrom: string; lines: RecipeLineInput[] },
) => api.post<RecipeView>(`${recipeBase(kind, id)}/recipe-versions`, version);

export const replaceRecipeLines = (versionId: string, lines: RecipeLineInput[]) =>
  api.put<RecipeView>(`/recipe-versions/${segment(versionId)}/lines`, { lines });

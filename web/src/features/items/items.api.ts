// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Items and units (backend `modules/items/items.controller.ts`).
import { api } from '@/lib/api-client';

export interface UnitView {
  code: string;
  nameTh: string;
  nameEn: string;
  /** How finely a quantity in this unit is kept: 3 for kg (grams), 0 for pieces. */
  decimals: number;
}

export interface PurchaseUnit {
  unitCode: string;
  /** Base units in one purchase unit, as an exact decimal string ("20", "22.5"). */
  factor: string;
}

export interface ItemView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
  shelfLifeDays: number;
  active: boolean;
  purchaseUnits: PurchaseUnit[];
  /** The master data version of the item's latest change; sent back with an edit. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ItemFields {
  nameTh: string;
  nameEn: string;
  variableWeight: boolean;
  shelfLifeDays: number;
  purchaseUnits: PurchaseUnit[];
}

export interface NewItem extends ItemFields {
  code: string;
  baseUnitCode: string;
}

/** Only the fields that change, with the version the editor was opened at. */
export type ItemChange = Partial<ItemFields> & { version: number; active?: boolean };

/** One purchase-unit row the API refused, and why (backend `domain/item-rules.ts`). */
export interface PurchaseUnitIssue {
  index: number;
  unitCode: string;
  problem: string;
}

export const listUnits = () => api.get<UnitView[]>('/units');

/** Every item, active or not: the list filters on screen, so searching needs no round trip. */
export const listItems = () => api.get<ItemView[]>('/items', { query: { status: 'all' } });

export const createItem = (item: NewItem) => api.post<ItemView>('/items', item);

export const updateItem = (id: string, change: ItemChange) =>
  api.patch<ItemView>(`/items/${encodeURIComponent(id)}`, change);

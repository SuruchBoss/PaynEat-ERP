// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Items and units (backend `modules/items/items.controller.ts`).
import type { Language } from '@/i18n/catalogue';
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
  /** What the receiving dock checks (#11): configuration, not master data. Null = no check. */
  receivingTolerances: ReceivingTolerances;
  /** Base units the plant packs and sends together (#15): requisitions are asked for in whole ones. */
  requisitionUnit: string | null;
  /** The master data version of the item's latest change; sent back with an edit. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReceivingTolerances {
  /** The largest difference between counted and expected quantity, in percent: "2". */
  maxVariancePercent: string | null;
  /** The warmest the goods may arrive, in °C: "4". */
  maxTemperature: string | null;
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

/** A unit's name in the person's language; its code when the catalogue has not loaded. */
export function unitName(units: readonly UnitView[], code: string, language: Language): string {
  const unit = units.find((u) => u.code === code);
  if (!unit) return code;
  return language === 'th' ? unit.nameTh : unit.nameEn;
}

/** Every item, active or not: the list filters on screen, so searching needs no round trip. */
export const listItems = () => api.get<ItemView[]>('/items', { query: { status: 'all' } });

export const createItem = (item: NewItem) => api.post<ItemView>('/items', item);

export const updateItem = (id: string, change: ItemChange) =>
  api.patch<ItemView>(`/items/${encodeURIComponent(id)}`, change);

/** Replaces the item's receiving tolerances (#11): the admin's configuration of the dock. */
export const setReceivingTolerances = (id: string, tolerances: ReceivingTolerances) =>
  api.put<ItemView>(`/items/${encodeURIComponent(id)}/receiving-tolerances`, tolerances);

/** Sets or clears the item's requisition unit (#15); null clears it. */
export const setRequisitionUnit = (id: string, requisitionUnit: string | null) =>
  api.put<ItemView>(`/items/${encodeURIComponent(id)}/requisition-unit`, { requisitionUnit });

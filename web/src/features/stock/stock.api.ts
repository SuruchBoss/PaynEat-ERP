// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Stock on hand (backend `modules/ledger/ledger.controller.ts`).
import { api } from '@/lib/api-client';
import type { LocationType } from '@/features/locations/locations.api';

/** Quantities, costs and values are exact decimal strings (ADR-0019): shown as they are. */
export interface StockOnHandRow {
  item: { id: string; code: string; nameTh: string; nameEn: string; baseUnitCode: string };
  lot: { id: string; number: string; expiryDate: string };
  location: { id: string; code: string; type: LocationType; nameTh: string; nameEn: string };
  /** With the base unit's decimals. Negative only at a branch (ADR-0003). */
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  value: string;
  /** Past its expiry date on the as-of date. */
  expired: boolean;
}

export interface StockOnHandView {
  asOf: string;
  rows: StockOnHandRow[];
  totalValue: string;
}

export interface StockOnHandQuery {
  /** YYYY-MM-DD; today in the company's time zone when left out. */
  asOf?: string;
  locationId?: string;
  itemId?: string;
}

export const stockOnHand = (query: StockOnHandQuery) =>
  api.get<StockOnHandView>('/stock-on-hand', {
    query: Object.fromEntries(Object.entries(query).filter(([, v]) => v)) as Record<string, string>,
  });

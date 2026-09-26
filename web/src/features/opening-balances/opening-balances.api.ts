// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Opening balances (backend `modules/opening-balances/opening-balances.controller.ts`).
import { api } from '@/lib/api-client';
import type { LocationType } from '@/features/locations/locations.api';

export interface PersonRef {
  id: string;
  displayName: string;
}

export interface ReversalRef {
  id: string;
  number: string;
  businessDate: string;
  note: string | null;
  postedAt: string;
  postedBy: PersonRef;
}

export interface OpeningBalanceLocation {
  id: string;
  code: string;
  type: LocationType;
  nameTh: string;
  nameEn: string;
}

/** The header every stock document shares. */
export interface DocumentHeader {
  id: string;
  number: string;
  status: 'draft' | 'posted';
  businessDate: string;
  note: string | null;
  /** Sent back with an edit or a posting: a draft changed since is refused. */
  revision: number;
  createdBy: PersonRef;
  createdAt: string;
  postedBy: PersonRef | null;
  postedAt: string | null;
  reversedBy: ReversalRef | null;
  location: OpeningBalanceLocation;
  totalValue: string;
}

export interface OpeningBalanceSummary extends DocumentHeader {
  lineCount: number;
}

export interface OpeningBalanceLine {
  lineNo: number;
  item: {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    baseUnitCode: string;
    variableWeight: boolean;
  };
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
  value: string;
  /** The lot this line became, once posted. */
  lot: { id: string; number: string } | null;
}

export interface OpeningBalanceView extends DocumentHeader {
  lines: OpeningBalanceLine[];
}

/** One line as a person enters it: every figure an exact decimal string. */
export interface LineInput {
  itemId: string;
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
}

export interface DraftInput {
  locationId: string;
  /** YYYY-MM-DD; left out, a new draft is dated today and a saved one keeps its date. */
  businessDate?: string;
  note: string;
  lines: LineInput[];
}

export const listOpeningBalances = () => api.get<OpeningBalanceSummary[]>('/opening-balances');

export const getOpeningBalance = (id: string) =>
  api.get<OpeningBalanceView>(`/opening-balances/${encodeURIComponent(id)}`);

export const createOpeningBalance = (draft: DraftInput) =>
  api.post<OpeningBalanceView>('/opening-balances', draft);

export const updateOpeningBalance = (id: string, revision: number, draft: DraftInput) =>
  api.patch<OpeningBalanceView>(`/opening-balances/${encodeURIComponent(id)}`, {
    revision,
    ...draft,
  });

export const postOpeningBalance = (id: string, revision: number) =>
  api.post<OpeningBalanceView>(`/opening-balances/${encodeURIComponent(id)}/post`, { revision });

export const reverseOpeningBalance = (id: string, businessDate: string, note: string) =>
  api.post<OpeningBalanceView>(`/opening-balances/${encodeURIComponent(id)}/reverse`, {
    ...(businessDate ? { businessDate } : {}),
    note,
  });

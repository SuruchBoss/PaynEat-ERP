// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Branch requisitions and par levels (backend `modules/requisitions/requisitions.controller.ts`,
// #15).
import { api } from '@/lib/api-client';
import type { PersonRef } from '@/features/opening-balances/opening-balances.api';
import type { TransferView } from '@/features/transfers/transfers.api';

export type RequisitionStatus =
  'draft' | 'submitted' | 'partially_fulfilled' | 'fulfilled' | 'cancelled';
export type RequisitionStatusFilter = 'all' | 'open' | RequisitionStatus;

export interface RequisitionItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
  /** Base units the plant sends together, or null. */
  requisitionUnit: string | null;
}

export interface RequisitionLocationRef {
  id: string;
  code: string;
  type: string;
  nameTh: string;
  nameEn: string;
}

export interface RequisitionLine {
  lineNo: number;
  item: RequisitionItemRef;
  /** What the screen suggested when the line was saved; null without a par level then. */
  suggested: string | null;
  requested: string;
  /** Left and not reversed, in transfers created from the requisition. */
  dispatched: string;
  /** Planned by its transfers still in draft. */
  drafted: string;
  /** What a new transfer would take. */
  outstanding: string;
}

export interface RequisitionSummary {
  id: string;
  number: string;
  status: RequisitionStatus;
  /** Sent back with every step: a requisition changed since is refused. */
  revision: number;
  branch: RequisitionLocationRef;
  supplyingLocation: RequisitionLocationRef;
  neededBy: string;
  lineCount: number;
  createdBy: PersonRef;
  createdAt: string;
  submittedAt: string | null;
}

export interface RequisitionView extends Omit<RequisitionSummary, 'lineCount'> {
  note: string | null;
  lines: RequisitionLine[];
  transfers: Array<{ id: string; number: string; status: string; businessDate: string }>;
  submitted: { by: PersonRef; at: string } | null;
  cancelled: { by: PersonRef; at: string; reason: string } | null;
}

export interface Suggestion {
  item: RequisitionItemRef;
  par: string | null;
  balance: string;
  inTransit: string;
  suggested: string | null;
}

export interface SuggestionsView {
  branch: RequisitionLocationRef;
  items: Suggestion[];
}

export interface ParLevelView {
  location: RequisitionLocationRef;
  item: RequisitionItemRef;
  quantity: string;
  updatedBy: PersonRef;
  updatedAt: string;
}

export interface ParMissRow {
  branch: RequisitionLocationRef;
  item: RequisitionItemRef;
  par: string | null;
  negativeEpisodes: number;
  linesDue: number;
  linesMissed: number;
}

export interface ParMissesView {
  from: string;
  to: string;
  rows: ParMissRow[];
}

export interface NewRequisition {
  branchId: string;
  supplyingLocationId?: string;
  neededBy: string;
  note?: string | null;
  lines: Array<{ itemId: string; requested: string }>;
}

const path = (id: string, step?: string) =>
  `/requisitions/${encodeURIComponent(id)}${step ? `/${step}` : ''}`;

export const listRequisitions = (status: RequisitionStatusFilter) =>
  api.get<RequisitionSummary[]>('/requisitions', { query: { status } });

export const getRequisition = (id: string) => api.get<RequisitionView>(path(id));

export const getSuggestions = (branchId: string) =>
  api.get<SuggestionsView>('/requisitions/suggestions', { query: { branchId } });

export const createRequisition = (input: NewRequisition) =>
  api.post<RequisitionView>('/requisitions', input);

export const submitRequisition = (id: string, revision: number) =>
  api.post<RequisitionView>(path(id, 'submit'), { revision });

export const cancelRequisition = (id: string, revision: number, reason: string) =>
  api.post<RequisitionView>(path(id, 'cancel'), { revision, reason });

/** A draft transfer from the requisition, prefilled with what is outstanding (#14). */
export const createTransferFrom = (id: string, revision: number) =>
  api.post<TransferView>(path(id, 'transfers'), { revision });

export const getParMisses = (query: { from?: string; to?: string; branchId?: string }) =>
  api.get<ParMissesView>('/requisitions/par-misses', {
    query: Object.fromEntries(Object.entries(query).filter(([, v]) => v)),
  });

export const listParLevels = () => api.get<ParLevelView[]>('/par-levels');

export const setParLevel = (locationId: string, itemId: string, quantity: string) =>
  api.put<ParLevelView>(
    `/par-levels/${encodeURIComponent(locationId)}/${encodeURIComponent(itemId)}`,
    { quantity },
  );

export const removeParLevel = (locationId: string, itemId: string) =>
  api.delete<void>(`/par-levels/${encodeURIComponent(locationId)}/${encodeURIComponent(itemId)}`);

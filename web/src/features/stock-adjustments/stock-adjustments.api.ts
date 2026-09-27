// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Stock adjustments (backend `modules/stock-adjustments/stock-adjustments.controller.ts`).
import { api } from '@/lib/api-client';
import type { LocationType } from '@/features/locations/locations.api';
import type { PersonRef } from '@/features/opening-balances/opening-balances.api';

export type AdjustmentStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected';

export interface AdjustmentLocation {
  id: string;
  code: string;
  type: LocationType;
  nameTh: string;
  nameEn: string;
}

/** Who took a step, and when. */
export interface StepRecord {
  by: PersonRef;
  at: string;
}

export interface AdjustmentHeader {
  id: string;
  number: string;
  status: AdjustmentStatus;
  businessDate: string;
  note: string | null;
  /** Sent back with every step: a document changed since is refused. */
  revision: number;
  createdBy: PersonRef;
  createdAt: string;
  postedBy: PersonRef | null;
  postedAt: string | null;
  location: AdjustmentLocation;
  /** Signed: a write-off takes value out. */
  totalValue: string;
}

export interface AdjustmentSummary extends AdjustmentHeader {
  lineCount: number;
}

export interface AdjustmentLine {
  lineNo: number;
  item: {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    baseUnitCode: string;
    variableWeight: boolean;
  };
  lot: { id: string; number: string; expiryDate: string };
  /** Signed, with the base unit's decimals. */
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  value: string;
  reason: string;
}

export interface AdjustmentView extends AdjustmentHeader {
  submitted: StepRecord | null;
  approved: StepRecord | null;
  rejected: (StepRecord & { reason: string }) | null;
  lines: AdjustmentLine[];
}

/** Approving posts at once; when the ledger refuses, the approval stands and this says why. */
export interface ApprovedView extends AdjustmentView {
  postingRefusal: { rule: string; message: string; details: Record<string, unknown> } | null;
}

export interface AdjustmentLineInput {
  lotId: string;
  /** Signed decimal string: "-1.8" takes 1.8 out. */
  quantity: string;
  secondaryQuantity: string | null;
  reason: string;
}

export interface AdjustmentInput {
  locationId: string;
  /** YYYY-MM-DD; left out, a new draft is dated today and a saved one keeps its date. */
  businessDate?: string;
  note: string;
  lines: AdjustmentLineInput[];
}

const path = (id: string, step = '') =>
  `/stock-adjustments/${encodeURIComponent(id)}${step ? `/${step}` : ''}`;

export const listAdjustments = () => api.get<AdjustmentSummary[]>('/stock-adjustments');

export const getAdjustment = (id: string) => api.get<AdjustmentView>(path(id));

export const createAdjustment = (input: AdjustmentInput) =>
  api.post<AdjustmentView>('/stock-adjustments', input);

export const updateAdjustment = (id: string, revision: number, input: AdjustmentInput) =>
  api.patch<AdjustmentView>(path(id), { revision, ...input });

export const submitAdjustment = (id: string, revision: number) =>
  api.post<AdjustmentView>(path(id, 'submit'), { revision });

export const approveAdjustment = (id: string, revision: number) =>
  api.post<ApprovedView>(path(id, 'approve'), { revision });

export const postAdjustment = (id: string, revision: number) =>
  api.post<AdjustmentView>(path(id, 'post'), { revision });

export const rejectAdjustment = (id: string, revision: number, reason: string) =>
  api.post<AdjustmentView>(path(id, 'reject'), { revision, reason });

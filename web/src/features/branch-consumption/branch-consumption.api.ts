// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Branch consumption (backend `modules/branch-consumption/branch-consumption.controller.ts`, #17).
import { api } from '@/lib/api-client';
import type { PersonRef } from '@/features/opening-balances/opening-balances.api';

export type ProblemReason =
  | 'unknown_menu_item'
  | 'unknown_modifier'
  | 'no_recipe_in_effect'
  | 'sold_by_mismatch'
  | 'inactive_ingredient'
  | 'negative_usage'
  | 'sale_time_ahead';

export type NotReprocessableBecause =
  'sale_date_not_yet' | 'past_sale_without_recipe' | 'not_fixable';

/** A sales event that failed or is held (ADR-0030), with whether re-processing can help now. */
export interface SalesEventProblem {
  salesEventId: string;
  idempotencyKey: string;
  posInstanceCode: string;
  branch: { id: string; code: string };
  saleTime: string;
  receivedAt: string;
  menuItemCode: string;
  quantity: string | null;
  weightKg: string | null;
  modifiers: Array<{ code: string; quantity: string }>;
  outcome: 'failed' | 'held';
  reason: ProblemReason;
  detail: Record<string, unknown> | null;
  recordedAt: string;
  reprocessable: boolean;
  notReprocessableBecause: NotReprocessableBecause | null;
}

export interface ConsumptionSummary {
  documentId: string;
  number: string;
  saleTime: string;
  branch: { id: string; code: string };
  menuItemCode: string;
  idempotencyKey: string;
  shortfall: boolean;
  consumedExpiredLot: boolean;
  placeholder: boolean;
}

export interface ConsumedLot {
  id: string;
  number: string;
  quantity: string;
  unitCost: string;
  placeholderCost: 'estimated' | 'unknown' | null;
  expired: boolean;
}

export interface NamedRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
}

export interface ConsumptionView {
  documentId: string;
  number: string;
  status: 'draft' | 'posted';
  businessDate: string;
  saleTime: string;
  branch: NamedRef;
  salesEvent: { id: string; idempotencyKey: string; posInstanceCode: string };
  menuItem: NamedRef;
  recipeEffectiveFrom: string;
  shortfall: boolean;
  consumedExpiredLot: boolean;
  placeholder: boolean;
  postedBy: PersonRef | null;
  postedAt: string | null;
  lines: Array<{
    lineNo: number;
    item: NamedRef & { baseUnitCode: string };
    usage: string;
    quantity: string;
    lots: ConsumedLot[];
  }>;
}

export interface UsageRow {
  date: string;
  branch: NamedRef;
  item: NamedRef & { baseUnitCode: string };
  quantity: string;
  value: string;
  estimatedCost: boolean;
  unknownCost: boolean;
  consumedExpiredLot: boolean;
}

export interface ProcessingRun {
  processed: number;
  failed: number;
  held: number;
  waiting: number;
  skipped: number;
}

export interface PeriodQuery {
  from: string;
  to: string;
  branchId: string;
}

const period = (query: PeriodQuery) => ({
  query: Object.fromEntries(Object.entries(query).filter(([, v]) => v)),
});

export const listProblems = (branchId: string) =>
  api.get<SalesEventProblem[]>('/branch-consumption/problems', {
    query: branchId ? { branchId } : {},
  });

export const listConsumptions = (query: PeriodQuery) =>
  api.get<ConsumptionSummary[]>('/branch-consumption', period(query));

export const getConsumption = (documentId: string) =>
  api.get<ConsumptionView>(`/branch-consumption/${documentId}`);

export const getUsage = (query: PeriodQuery) =>
  api.get<UsageRow[]>('/branch-consumption/usage', period(query));

export const runProcessor = () => api.post<ProcessingRun>('/branch-consumption/run', {});

export const reprocess = (salesEventId: string) =>
  api.post<{ problem: SalesEventProblem | null }>(
    `/branch-consumption/sales-events/${salesEventId}/reprocess`,
    {},
  );

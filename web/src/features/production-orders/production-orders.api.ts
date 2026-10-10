// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Production orders (backend `modules/production-orders/production-orders.controller.ts`, #13).
import { api } from '@/lib/api-client';
import type { PersonRef } from '@/features/opening-balances/opening-balances.api';

export type ProductionOrderStatus = 'draft' | 'released' | 'posted' | 'cancelled';
export type StatusFilter = 'all' | ProductionOrderStatus;

export interface OrderItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
  /** Not counted in kg or g: a measured weight is recorded for it. */
  weighed: boolean;
}

export interface YieldView {
  expected: string;
  actual: string | null;
  difference: string | null;
}

export interface AvailableLot {
  lotId: string;
  number: string;
  expiryDate: string;
  expired: boolean;
  unitCost: string;
  available: string;
  availablePieces: string | null;
}

export interface PickView {
  lotId: string;
  number: string;
  expiryDate: string;
  quantity: string;
  pieces: string | null;
  unitCost: string;
  value: string;
}

export interface InputLine {
  lineNo: number;
  item: OrderItemRef;
  plannedQuantity: string;
  picks: PickView[];
  picksOverridden: boolean;
  shortBy: string | null;
  quantity: string;
  weightKg: string | null;
  availableLots: AvailableLot[];
}

export interface CostView {
  allocatedValue: string;
  unitCost: string;
  lotValue: string;
  roundingDifference: string;
}

export interface OutputLine {
  lineNo: number;
  item: OrderItemRef;
  plannedQuantity: string;
  allocationRatio: string;
  actualQuantity: string | null;
  actualPieces: string | null;
  actualWeightKg: string | null;
  yield: YieldView;
  cost: CostView | null;
  expiry: {
    expiryDate: string;
    computedExpiryDate: string;
    earliestInputExpiryDate: string;
  } | null;
  lot: { id: string; number: string } | null;
}

export interface Blocker {
  rule: string;
  side?: 'input' | 'output';
  lineNo?: number;
}

export interface GenealogyLink {
  document: { id: string; number: string };
  outputLot: { id: string; number: string; itemId: string };
  inputLot: { id: string; number: string; itemId: string };
  inputQuantity: string;
  reversed: boolean;
}

interface OrderHeader {
  id: string;
  number: string;
  status: ProductionOrderStatus;
  businessDate: string;
  note: string | null;
  /** Sent back with every step: an order changed since is refused. */
  revision: number;
  createdBy: PersonRef;
  createdAt: string;
  postedBy: PersonRef | null;
  postedAt: string | null;
  reversedBy: { id: string; number: string } | null;
  bom: {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    version: { id: string; number: number; effectiveFrom: string };
  };
  location: { id: string; code: string; nameTh: string; nameEn: string };
  plannedQuantity: string;
  yield: YieldView;
}

export interface ProductionOrderSummary extends OrderHeader {
  plannedItem: OrderItemRef;
}

export interface ProductionOrderView extends OrderHeader {
  released: { by: PersonRef; at: string } | null;
  cancelled: { by: PersonRef; at: string; reason: string } | null;
  inputs: InputLine[];
  outputs: OutputLine[];
  inputValue: string;
  blockers: Blocker[];
  genealogy: GenealogyLink[];
}

export interface CreateOrderInput {
  bomId: string;
  locationId: string;
  plannedQuantity: string;
  businessDate?: string;
  note: string;
}

export interface ActualsInput {
  inputs?: Array<{
    lineNo: number;
    picks: Array<{ lotId: string; quantity: string; pieces: string | null }>;
    weightKg: string | null;
  }>;
  outputs?: Array<{
    lineNo: number;
    quantity: string | null;
    pieces: string | null;
    weightKg: string | null;
  }>;
}

const path = (id: string, step = '') =>
  `/production-orders/${encodeURIComponent(id)}${step ? `/${step}` : ''}`;

export const listProductionOrders = (status: StatusFilter) =>
  api.get<ProductionOrderSummary[]>('/production-orders', { query: { status } });

export const getProductionOrder = (id: string) => api.get<ProductionOrderView>(path(id));

export const createProductionOrder = (input: CreateOrderInput) =>
  api.post<ProductionOrderView>('/production-orders', input);

export const updateProductionOrder = (
  id: string,
  revision: number,
  input: Partial<Omit<CreateOrderInput, 'bomId'>>,
) => api.patch<ProductionOrderView>(path(id), { revision, ...input });

export const stepProductionOrder = (id: string, step: 'release' | 'post', revision: number) =>
  api.post<ProductionOrderView>(path(id, step), { revision });

export const recordActuals = (id: string, revision: number, input: ActualsInput) =>
  api.put<ProductionOrderView>(path(id, 'actuals'), { revision, ...input });

export const cancelProductionOrder = (id: string, revision: number, reason: string) =>
  api.post<ProductionOrderView>(path(id, 'cancel'), { revision, reason });

export const reverseProductionOrder = (id: string, note: string) =>
  api.post<{ order: ProductionOrderView; reversal: { id: string; number: string } }>(
    path(id, 'reverse'),
    { note },
  );

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Purchase orders (backend `modules/purchase-orders/purchase-orders.controller.ts`).
import { api } from '@/lib/api-client';
import type { LocationType } from '@/features/locations/locations.api';
import type { PersonRef } from '@/features/opening-balances/opening-balances.api';

export type PurchaseOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'rejected'
  | 'cancelled';

export interface Money {
  net: string;
  vat: string;
  gross: string;
}

export interface PurchaseOrderSummary {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  /** Sent back with every step: an order changed since is refused. */
  revision: number;
  supplier: { id: string; code: string; name: string; taxId: string };
  deliveryLocation: {
    id: string;
    code: string;
    type: LocationType;
    nameTh: string;
    nameEn: string;
  };
  expectedDeliveryDate: string;
  lineCount: number;
  totals: Money;
  createdBy: PersonRef;
  createdAt: string;
}

export interface PurchaseOrderLine extends Money {
  lineNo: number;
  item: {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    active: boolean;
    baseUnitCode: string;
  };
  unit: { code: string; nameTh: string; nameEn: string };
  factor: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  vatRecoverable: boolean;
  baseQuantity: string;
  /** Per base unit, net of recoverable VAT: what a goods receipt will set lot cost from. */
  unitCost: string;
}

export interface PurchaseOrderView extends Omit<PurchaseOrderSummary, 'lineCount'> {
  note: string | null;
  submitted: { by: PersonRef; at: string; approvalThreshold: string } | null;
  /** `by` is null when submitting approved it, within the threshold. */
  approved: { by: PersonRef | null; at: string; automatically: boolean } | null;
  rejected: { by: PersonRef; at: string; reason: string } | null;
  sent: { by: PersonRef; at: string } | null;
  cancelled: { by: PersonRef; at: string; reason: string } | null;
  approval: { threshold: string; needsApprover: boolean };
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderLineInput {
  itemId: string;
  unitCode: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  vatRecoverable: boolean;
}

export interface PurchaseOrderInput {
  supplierId: string;
  deliveryLocationId: string;
  expectedDeliveryDate: string;
  note: string;
  lines: PurchaseOrderLineInput[];
}

export type StatusFilter = 'all' | PurchaseOrderStatus;

const path = (id: string, step = '') =>
  `/purchase-orders/${encodeURIComponent(id)}${step ? `/${step}` : ''}`;

export const listPurchaseOrders = (status: StatusFilter) =>
  api.get<PurchaseOrderSummary[]>('/purchase-orders', { query: { status } });

export const getPurchaseOrder = (id: string) => api.get<PurchaseOrderView>(path(id));

export const createPurchaseOrder = (input: PurchaseOrderInput) =>
  api.post<PurchaseOrderView>('/purchase-orders', input);

export const updatePurchaseOrder = (id: string, revision: number, input: PurchaseOrderInput) =>
  api.patch<PurchaseOrderView>(path(id), { revision, ...input });

export const stepPurchaseOrder = (
  id: string,
  step: 'submit' | 'approve' | 'send',
  revision: number,
) => api.post<PurchaseOrderView>(path(id, step), { revision });

export const decidePurchaseOrder = (
  id: string,
  step: 'reject' | 'cancel',
  revision: number,
  reason: string,
) => api.post<PurchaseOrderView>(path(id, step), { revision, reason });

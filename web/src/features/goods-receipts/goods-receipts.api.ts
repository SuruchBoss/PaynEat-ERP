// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Goods receipts and returns to supplier (backend `modules/goods-receipts/goods-receipts.controller.ts`).
import { api } from '@/lib/api-client';
import type { LocationType } from '@/features/locations/locations.api';
import type { PersonRef } from '@/features/opening-balances/opening-balances.api';

export type GoodsReceiptStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected';
export type Condition = 'good' | 'damaged';

/** Something about a line outside the item's tolerances (backend `core/receiving/domain/inspection.ts`). */
export type Finding =
  | {
      code: 'over_quantity' | 'under_quantity';
      variancePercent: string | null;
      limitPercent: string;
    }
  | { code: 'too_warm'; temperature: string; limit: string }
  | { code: 'damaged' }
  | { code: 'short_dated'; supplierExpiry: string; computedExpiry: string };

export interface GoodsReceiptLine {
  lineNo: number;
  purchaseOrderLineNo: number;
  item: {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    baseUnitCode: string;
    variableWeight: boolean;
  };
  unit: { code: string; nameTh: string; nameEn: string };
  factor: string;
  countedQuantity: string;
  rejectedQuantity: string;
  acceptedQuantity: string;
  countedBaseQuantity: string;
  rejectedBaseQuantity: string;
  acceptedBaseQuantity: string;
  countedPieces: string | null;
  rejectedPieces: string | null;
  acceptedPieces: string | null;
  temperature: string | null;
  condition: Condition;
  reason: string | null;
  orderedBaseQuantity: string;
  expectedBaseQuantity: string;
  findings: Finding[];
  expiry: {
    computedExpiry: string;
    supplierExpiry: string | null;
    expiryDate: string;
    takes: 'computed' | 'supplier';
  };
  unitCost: string;
  value: string;
  overReceipt: boolean;
  lot: { id: string; number: string } | null;
}

interface ReceiptHeader {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  businessDate: string;
  note: string | null;
  /** Sent back with every step: a receipt changed since is refused. */
  revision: number;
  createdBy: PersonRef;
  createdAt: string;
  postedBy: PersonRef | null;
  postedAt: string | null;
  purchaseOrder: { id: string; number: string; status: string };
  supplier: { id: string; code: string; name: string };
  location: { id: string; code: string; type: LocationType; nameTh: string; nameEn: string };
  totalValue: string;
}

export interface GoodsReceiptSummary extends ReceiptHeader {
  lineCount: number;
  linesWithFindings: number;
}

export interface GoodsReceiptView extends ReceiptHeader {
  submitted: { by: PersonRef; at: string } | null;
  approved: { by: PersonRef; at: string } | null;
  rejected: { by: PersonRef; at: string; reason: string } | null;
  needsApproval: boolean;
  lines: GoodsReceiptLine[];
  supplierReturn: { id: string; number: string } | null;
}

export interface SteppedGoodsReceiptView extends GoodsReceiptView {
  /** Why the ledger refused to post it; the receipt stays where it was. */
  postingRefusal: { rule: string; message: string; details: Record<string, unknown> } | null;
}

export interface GoodsReceiptPreview {
  lines: GoodsReceiptLine[];
  needsApproval: boolean;
  totalValue: string;
}

export interface GoodsReceiptLineInput {
  purchaseOrderLineNo: number;
  unitCode: string;
  countedQuantity: string;
  rejectedQuantity: string;
  countedPieces: string | null;
  rejectedPieces: string | null;
  temperature: string | null;
  condition: Condition;
  supplierExpiry: string | null;
  reason: string | null;
}

export interface GoodsReceiptInput {
  purchaseOrderId: string;
  businessDate?: string;
  note: string;
  lines: GoodsReceiptLineInput[];
}

export interface SupplierReturnView {
  id: string;
  number: string;
  goodsReceipt: { id: string; number: string };
  purchaseOrder: { id: string; number: string };
  supplier: { id: string; code: string; name: string };
  businessDate: string;
  createdBy: PersonRef;
  createdAt: string;
  lines: Array<{
    lineNo: number;
    receiptLineNo: number;
    item: GoodsReceiptLine['item'];
    quantity: string;
    secondaryQuantity: string | null;
    reason: string;
  }>;
}

export type StatusFilter = 'all' | GoodsReceiptStatus;

const path = (id: string, step = '') =>
  `/goods-receipts/${encodeURIComponent(id)}${step ? `/${step}` : ''}`;

export const listGoodsReceipts = (status: StatusFilter, purchaseOrderId?: string) =>
  api.get<GoodsReceiptSummary[]>('/goods-receipts', {
    query: purchaseOrderId ? { status, purchaseOrderId } : { status },
  });

export const getGoodsReceipt = (id: string) => api.get<GoodsReceiptView>(path(id));

export const previewGoodsReceipt = (input: GoodsReceiptInput) =>
  api.post<GoodsReceiptPreview>('/goods-receipts/preview', input);

export const createGoodsReceipt = (input: GoodsReceiptInput) =>
  api.post<GoodsReceiptView>('/goods-receipts', input);

export const updateGoodsReceipt = (
  id: string,
  revision: number,
  input: Omit<GoodsReceiptInput, 'purchaseOrderId'>,
) => api.patch<GoodsReceiptView>(path(id), { revision, ...input });

export const stepGoodsReceipt = (
  id: string,
  step: 'submit' | 'approve' | 'post',
  revision: number,
) => api.post<SteppedGoodsReceiptView>(path(id, step), { revision });

export const rejectGoodsReceipt = (id: string, revision: number, reason: string) =>
  api.post<GoodsReceiptView>(path(id, 'reject'), { revision, reason });

export const listSupplierReturns = (purchaseOrderId?: string) =>
  api.get<SupplierReturnView[]>('/supplier-returns', {
    query: purchaseOrderId ? { purchaseOrderId } : {},
  });

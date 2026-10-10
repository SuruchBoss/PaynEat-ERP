// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Transfers and transfer receipts (backend `modules/transfers/transfers.controller.ts`, #14).
import { api } from '@/lib/api-client';
import type { PersonRef } from '@/features/opening-balances/opening-balances.api';

export type TransferStatus = 'draft' | 'dispatched' | 'received' | 'reversed' | 'cancelled';
export type TransferStatusFilter = 'all' | TransferStatus;
export type ReceiptStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected';

export interface TransferItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
}

export interface TransferLocationRef {
  id: string;
  code: string;
  type: string;
  nameTh: string;
  nameEn: string;
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

export interface PickOutcome {
  accepted: string;
  acceptedPieces: string | null;
  returned: string;
  returnedPieces: string | null;
  writtenOff: string;
  writtenOffPieces: string | null;
  writtenOffValue: string;
  reason: string | null;
}

export interface TransferPick {
  /** Null on a draft's suggestion. */
  pickNo: number | null;
  lotId: string;
  number: string;
  expiryDate: string;
  unitCost: string;
  quantity: string;
  pieces: string | null;
  outcome: PickOutcome | null;
}

export interface TransferLine {
  lineNo: number;
  item: TransferItemRef;
  quantity: string;
  picks: TransferPick[];
  dispatched: string;
  shortBy: string | null;
  availableLots: AvailableLot[];
  accepted: string | null;
  returned: string | null;
  writtenOff: string | null;
}

export interface Check {
  rule: string;
  lineNo?: number;
  lotId?: string;
}

interface Header {
  id: string;
  number: string;
  businessDate: string;
  note: string | null;
  /** Sent back with every step: a document changed since is refused. */
  revision: number;
  createdBy: PersonRef;
  createdAt: string;
}

export interface ReceiptRef {
  id: string;
  number: string;
  status: ReceiptStatus;
  businessDate: string;
  createdBy: PersonRef;
}

export interface TransferSummary extends Header {
  status: TransferStatus;
  origin: TransferLocationRef;
  destination: TransferLocationRef;
  lineCount: number;
  receivedBy: { receipt: { id: string; number: string } } | null;
}

export interface TransferView extends Header {
  status: TransferStatus;
  origin: TransferLocationRef;
  destination: TransferLocationRef;
  inTransit: TransferLocationRef | null;
  dispatched: { by: PersonRef; at: string } | null;
  cancelled: { by: PersonRef; at: string; reason: string } | null;
  received: {
    receipt: { id: string; number: string; businessDate: string };
    by: PersonRef;
    approvedBy: PersonRef | null;
    at: string;
  } | null;
  /** The reversal that took the dispatch back to the origin while nothing had been received. */
  reversed: {
    reversal: { id: string; number: string; businessDate: string };
    by: PersonRef;
    at: string;
    note: string | null;
  } | null;
  lines: TransferLine[];
  blockers: Check[];
  receipts: ReceiptRef[];
}

export type Finding =
  | {
      code: 'over_quantity' | 'under_quantity';
      variancePercent: string | null;
      limitPercent: string;
    }
  | { code: 'too_warm'; temperature: string; limit: string }
  | { code: 'damaged' }
  | { code: 'short_dated'; supplierExpiry: string; computedExpiry: string };

export interface ReceiptLine {
  lineNo: number;
  item: TransferItemRef;
  lot: { id: string; number: string; expiryDate: string; unitCost: string };
  dispatched: string;
  dispatchedPieces: string | null;
  received: string;
  receivedPieces: string | null;
  temperature: string | null;
  condition: string;
  accepted: string;
  acceptedPieces: string | null;
  returned: string;
  returnedPieces: string | null;
  writtenOff: string;
  writtenOffPieces: string | null;
  reason: string | null;
  findings: Finding[];
  reasonRequired: boolean;
  unresolved: string;
  tolerances: { maxVariancePercent: string | null; maxTemperature: string | null };
}

export interface TransferReceiptView extends Header {
  status: ReceiptStatus;
  transfer: {
    id: string;
    number: string;
    status: TransferStatus;
    businessDate: string;
    origin: TransferLocationRef;
    destination: TransferLocationRef;
  };
  location: TransferLocationRef;
  submitted: { by: PersonRef; at: string } | null;
  approved: { by: PersonRef; at: string } | null;
  rejected: { by: PersonRef; at: string; reason: string } | null;
  postedBy: PersonRef | null;
  postedAt: string | null;
  lines: ReceiptLine[];
  needsApproval: boolean;
  blockers: Check[];
  /** Steps that may post: why the ledger refused, when it did. */
  postingRefusal?: { rule: string; message: string; details: Record<string, unknown> } | null;
}

export interface InTransitView {
  asOf: string;
  transfers: Array<{
    transfer: { id: string; number: string; businessDate: string };
    origin: TransferLocationRef;
    destination: TransferLocationRef;
    inTransit: TransferLocationRef;
    lots: Array<{
      item: TransferItemRef;
      lot: { id: string; number: string; expiryDate: string };
      quantity: string;
      pieces: string | null;
    }>;
  }>;
}

export interface CreateTransferInput {
  originId: string;
  destinationId: string;
  businessDate?: string;
  note: string;
  lines: Array<{ itemId: string; quantity: string }>;
}

export interface DispatchPickInput {
  lineNo: number;
  lotId: string;
  quantity: string;
  pieces: string | null;
}

export interface ReceiptLineInput {
  lineNo: number;
  received: string;
  receivedPieces: string | null;
  temperature: string | null;
  condition: string;
  accepted: string;
  acceptedPieces: string | null;
  returned: string;
  returnedPieces: string | null;
  writtenOff: string;
  writtenOffPieces: string | null;
  reason: string | null;
}

const transferPath = (id: string, step = '') =>
  `/transfers/${encodeURIComponent(id)}${step ? `/${step}` : ''}`;
const receiptPath = (id: string, step = '') =>
  `/transfer-receipts/${encodeURIComponent(id)}${step ? `/${step}` : ''}`;

export const listTransfers = (status: TransferStatusFilter) =>
  api.get<TransferSummary[]>('/transfers', { query: { status } });

export const getTransfer = (id: string) => api.get<TransferView>(transferPath(id));

export const createTransfer = (input: CreateTransferInput) =>
  api.post<TransferView>('/transfers', input);

export const dispatchTransfer = (id: string, revision: number, picks: DispatchPickInput[]) =>
  api.post<TransferView>(transferPath(id, 'dispatch'), { revision, picks });

export const cancelTransfer = (id: string, revision: number, reason: string) =>
  api.post<TransferView>(transferPath(id, 'cancel'), { revision, reason });

/** Takes a dispatch back to the origin while no receipt of it has posted (ADR-0028). */
export const reverseTransfer = (id: string, note: string) =>
  api.post<TransferView>(transferPath(id, 'reverse'), note ? { note } : {});

export const inTransit = (asOf?: string) =>
  api.get<InTransitView>('/transfers/in-transit', {
    query: (asOf ? { asOf } : {}) as Record<string, string>,
  });

export const createReceipt = (transferId: string, lines: ReceiptLineInput[]) =>
  api.post<TransferReceiptView>(transferPath(transferId, 'receipts'), { lines });

export const getReceipt = (id: string) => api.get<TransferReceiptView>(receiptPath(id));

export const updateReceipt = (id: string, revision: number, lines: ReceiptLineInput[]) =>
  api.patch<TransferReceiptView>(receiptPath(id), { revision, lines });

export const stepReceipt = (id: string, step: 'submit' | 'approve' | 'post', revision: number) =>
  api.post<TransferReceiptView>(receiptPath(id, step), { revision });

export const rejectReceipt = (id: string, revision: number, reason: string) =>
  api.post<TransferReceiptView>(receiptPath(id, 'reject'), { revision, reason });

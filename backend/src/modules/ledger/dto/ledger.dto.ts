// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type { LocationType } from '../domain/posting-rules';

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class StockOnHandQueryDto {
  /** A business date, YYYY-MM-DD; today in the company's time zone when left out. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_PATTERN, { message: 'asOf must be a date written YYYY-MM-DD' })
  asOf?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;
}

export interface PersonRef {
  id: string;
  displayName: string;
}

export interface DocumentRef {
  id: string;
  number: string;
}

export interface ReversalRef extends DocumentRef {
  businessDate: string;
  note: string | null;
  postedAt: Date;
  postedBy: PersonRef;
}

export type StockDocumentType =
  | 'opening_balance'
  | 'reversal'
  | 'stock_adjustment'
  | 'goods_receipt'
  | 'production_order'
  | 'transfer'
  | 'transfer_receipt';

/**
 * draft → posted for an opening balance; draft → submitted → approved → posted, or rejected,
 * for a document a second person approves (stock adjustments, #8, ADR-0008; goods receipts
 * with a finding, #11); draft → released → posted, or cancelled, for a production order (#13);
 * draft → posted (dispatched), or cancelled, for a transfer, and draft → submitted → approved →
 * posted, or rejected, for its receipt (#14).
 */
export type StockDocumentStatus =
  'draft' | 'submitted' | 'approved' | 'posted' | 'rejected' | 'released' | 'cancelled';

/** The header every stock document shares. */
export interface StockDocumentView {
  id: string;
  number: string;
  type: StockDocumentType;
  status: StockDocumentStatus;
  businessDate: string;
  note: string | null;
  revision: number;
  createdBy: PersonRef;
  createdAt: Date;
  postedBy: PersonRef | null;
  postedAt: Date | null;
  /** Reversals only: the document negated. */
  reverses: DocumentRef | null;
  /** The reversal that negated this document, if any. */
  reversedBy: ReversalRef | null;
}

/** A lot a posted document created. Quantities are decimal strings (ADR-0019). */
export interface LotView {
  id: string;
  number: string;
  lineNo: number;
  itemId: string;
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
  /** Received lots only (ADR-0014): both dates the expiry was chosen from. */
  computedExpiryDate: string | null;
  supplierExpiryDate: string | null;
}

export interface StockOnHandRow {
  item: { id: string; code: string; nameTh: string; nameEn: string; baseUnitCode: string };
  lot: { id: string; number: string; expiryDate: string };
  location: { id: string; code: string; type: LocationType; nameTh: string; nameEn: string };
  /** With the base unit's decimals: "21.600" kg, "40" pieces. Negative only at a branch. */
  quantity: string;
  secondaryQuantity: string | null;
  /** Per base unit, the lot's cost. */
  unitCost: string;
  /** quantity × unitCost, exact. */
  value: string;
  /** Past its expiry date on the as-of date: it cannot be issued, only written off (ADR-0006). */
  expired: boolean;
  /**
   * Below zero at a branch: allowed, because a branch's stock follows sales that already
   * happened, and flagged, because it means the records and the shelf disagree and the lot
   * should be counted (ADR-0003, #8).
   */
  countRecommended: boolean;
}

export interface StockOnHandView {
  asOf: string;
  rows: StockOnHandRow[];
  totalValue: string;
  /** How many of the rows are flagged `countRecommended`. */
  negativeBranchBalances: number;
}

/**
 * One genealogy link (ADR-0006): an output lot a production order made, and an input lot it
 * consumed, with what the order consumed of that input as a whole.
 */
export interface GenealogyLink {
  document: DocumentRef;
  outputLot: { id: string; number: string; itemId: string };
  inputLot: { id: string; number: string; itemId: string };
  inputQuantity: string;
  /**
   * The order was reversed: the link stays in history but no longer belongs in a trace,
   * because the output lot it describes was taken back out of stock.
   */
  reversed: boolean;
}

/** Where the balance snapshot and the ledger disagree for one lot at one location. */
export interface BalanceDifference {
  lotId: string;
  locationId: string;
  snapshot: { quantity: string | null; secondaryQuantity: string | null };
  ledger: { quantity: string | null; secondaryQuantity: string | null };
}

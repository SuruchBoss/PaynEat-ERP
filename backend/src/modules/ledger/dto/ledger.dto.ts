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

/** The header every stock document shares. */
export interface StockDocumentView {
  id: string;
  number: string;
  type: 'opening_balance' | 'reversal';
  status: 'draft' | 'posted';
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
}

export interface StockOnHandView {
  asOf: string;
  rows: StockOnHandRow[];
  totalValue: string;
}

/** Where the balance snapshot and the ledger disagree for one lot at one location. */
export interface BalanceDifference {
  lotId: string;
  locationId: string;
  snapshot: { quantity: string | null; secondaryQuantity: string | null };
  ledger: { quantity: string | null; secondaryQuantity: string | null };
}

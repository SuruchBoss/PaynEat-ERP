// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { PersonRef, PostingRule, StockDocumentView } from '../../ledger/ledger.service';
import { REASON_MAX_LENGTH, REJECTION_REASON_MAX_LENGTH } from '../domain/adjustment-rules';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date written YYYY-MM-DD';
export const LINES_MAX = 200;
export const NOTE_MAX = 500;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An empty note is no note. */
const noteValue = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * One change to one lot. The quantity is a signed decimal string, never a JSON number
 * (ADR-0019): "-1.8" writes 1.8 kg off, "2" brings two pieces in. The item is the lot's own.
 */
export class StockAdjustmentLineDto {
  @IsUUID()
  lotId!: string;

  /** In the item's base unit; below zero takes stock out. */
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  quantity!: string;

  /** Variable-weight items only: the piece count, with the quantity's sign. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  secondaryQuantity?: string | null;

  /** Why: "damaged in the cold room". Every line has one. */
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(trimmed)
  reason!: string;
}

export class CreateStockAdjustmentDto {
  @IsUUID()
  locationId!: string;

  /** Today in the company's time zone when left out; never later than today. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  @Transform(noteValue)
  note?: string | null;

  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineDto)
  lines!: StockAdjustmentLineDto[];
}

/** Only what changes, with the revision the editor was opened at. `lines` replaces them all. */
export class UpdateStockAdjustmentDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  @Transform(noteValue)
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineDto)
  lines?: StockAdjustmentLineDto[];
}

/** Submit, approve or post: at the revision the person reviewed. */
export class StockAdjustmentStepDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

export class RejectStockAdjustmentDto extends StockAdjustmentStepDto {
  /** Why it was turned down, for the person who raised it. */
  @IsString()
  @MaxLength(REJECTION_REASON_MAX_LENGTH)
  @Transform(trimmed)
  reason!: string;
}

export const ADJUSTMENT_STATUS_FILTERS = [
  'draft',
  'submitted',
  'approved',
  'posted',
  'rejected',
  'all',
] as const;

export class StockAdjustmentsQueryDto {
  @IsOptional()
  @IsIn(ADJUSTMENT_STATUS_FILTERS)
  status: (typeof ADJUSTMENT_STATUS_FILTERS)[number] = 'all';

  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export interface LocationRef {
  id: string;
  code: string;
  type: string;
  nameTh: string;
  nameEn: string;
}

export interface StockAdjustmentLineView {
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
  /** The lot's own cost per base unit (ADR-0004). */
  unitCost: string;
  /** quantity × unitCost, exact and signed: a write-off is a negative value. */
  value: string;
  reason: string;
}

/** Who moved the adjustment through its steps, and when. */
export interface AdjustmentStepRecord {
  by: PersonRef;
  at: Date;
}

export interface StockAdjustmentView extends StockDocumentView {
  location: LocationRef;
  submitted: AdjustmentStepRecord | null;
  approved: AdjustmentStepRecord | null;
  rejected: (AdjustmentStepRecord & { reason: string }) | null;
  lines: StockAdjustmentLineView[];
  /** The sum of the lines' values: what the adjustment adds to (or takes from) stock value. */
  totalValue: string;
}

/**
 * What approving returns. The approval stands even when the ledger then refuses the posting
 * (the stock went elsewhere since it was submitted): the adjustment stays approved, and
 * `postingRefusal` says why, so it can be posted again later or rejected.
 */
export interface ApprovedStockAdjustmentView extends StockAdjustmentView {
  postingRefusal: {
    rule: PostingRule;
    message: string;
    details: Record<string, unknown>;
  } | null;
}

export interface StockAdjustmentSummary extends StockDocumentView {
  location: LocationRef;
  lineCount: number;
  totalValue: string;
}

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
import type { StockDocumentView } from '../../ledger/ledger.service';

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
 * One lot to be. Quantities and the cost are decimal strings, never JSON numbers (ADR-0019);
 * the service checks them against the item and says what is wrong.
 */
export class OpeningBalanceLineDto {
  @IsUUID()
  itemId!: string;

  /** In the item's base unit. */
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  quantity!: string;

  /** Variable-weight items only: the piece count. Null or left out otherwise. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  secondaryQuantity?: string | null;

  /** Per base unit. */
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  unitCost!: string;

  @IsString()
  @Matches(ISO_DATE, { message: `expiryDate ${DATE_MESSAGE}` })
  expiryDate!: string;
}

export class CreateOpeningBalanceDto {
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
  @Type(() => OpeningBalanceLineDto)
  lines!: OpeningBalanceLineDto[];
}

/** Only what changes, with the revision the editor was opened at. `lines` replaces them all. */
export class UpdateOpeningBalanceDto {
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
  @Type(() => OpeningBalanceLineDto)
  lines?: OpeningBalanceLineDto[];
}

export class PostOpeningBalanceDto {
  /** The revision the person reviewed: a draft changed since is not posted. */
  @IsInt()
  @Min(1)
  revision!: number;
}

export class ReverseOpeningBalanceDto {
  /** Today when left out; from the original's business date up to today. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  @Transform(noteValue)
  note?: string | null;
}

export class OpeningBalancesQueryDto {
  @IsOptional()
  @IsIn(['draft', 'posted', 'all'])
  status: 'draft' | 'posted' | 'all' = 'all';

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

export interface OpeningBalanceLineView {
  lineNo: number;
  item: {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    baseUnitCode: string;
    variableWeight: boolean;
  };
  /** With the base unit's decimals. */
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
  /** quantity × unitCost, exact. */
  value: string;
  /** The lot this line became, once posted. */
  lot: { id: string; number: string } | null;
}

export interface OpeningBalanceView extends StockDocumentView {
  location: LocationRef;
  lines: OpeningBalanceLineView[];
  totalValue: string;
}

export interface OpeningBalanceSummary extends StockDocumentView {
  location: LocationRef;
  lineCount: number;
  totalValue: string;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** The ecosystem-wide code shape (docs/GLOSSARY.md, "Location code"). */
export const ITEM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
export const SHELF_LIFE_MAX_DAYS = 36500;
export const PURCHASE_UNITS_MAX = 20;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PurchaseUnitDto {
  @IsString()
  @IsNotEmpty()
  unitCode!: string;

  /**
   * Base units in one of this unit, as a decimal string ("10", "22.5"): never a JSON
   * number, which cannot hold every decimal exactly (ADR-0019). Checked by the service.
   */
  @IsString()
  @Transform(trimmed)
  factor!: string;
}

class ItemFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn!: string;

  @IsBoolean()
  variableWeight!: boolean;

  @IsInt()
  @Min(1)
  @Max(SHELF_LIFE_MAX_DAYS)
  shelfLifeDays!: number;

  @IsArray()
  @ArrayMaxSize(PURCHASE_UNITS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PurchaseUnitDto)
  purchaseUnits!: PurchaseUnitDto[];
}

export class CreateItemDto extends ItemFieldsDto {
  /** Upper-cased on the way in; fixed once the item exists. */
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(ITEM_CODE_PATTERN, {
    message:
      'code must be 2–32 capital letters, digits or hyphens, starting with a letter or digit',
  })
  code!: string;

  /** Fixed once the item exists (ADR-0019). */
  @IsString()
  @IsNotEmpty()
  baseUnitCode!: string;
}

/**
 * Every field optional except `version`: the item version the change was made from, so
 * an edit made on a stale screen is refused instead of silently undoing someone else's.
 * `code` and `baseUnitCode` are not accepted: they never change.
 */
export class UpdateItemDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn?: string;

  @IsOptional()
  @IsBoolean()
  variableWeight?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SHELF_LIFE_MAX_DAYS)
  shelfLifeDays?: number;

  /** Items are deactivated, never deleted; `true` brings one back. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Replaces the whole list when given. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PURCHASE_UNITS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PurchaseUnitDto)
  purchaseUnits?: PurchaseUnitDto[];
}

/**
 * An item's receiving tolerances (#11, ADR-0007 decision 2), replaced as a pair. Decimal strings,
 * never JSON numbers (ADR-0019); null, or left out, means no check. Checked by the service.
 */
export class ReceivingTolerancesDto {
  /** The largest difference between counted and expected quantity, in percent: "2". */
  @IsOptional()
  @IsString()
  @Transform(trimmed)
  maxVariancePercent?: string | null;

  /** The warmest the goods may arrive, in °C: "4", "-18". */
  @IsOptional()
  @IsString()
  @Transform(trimmed)
  maxTemperature?: string | null;
}

export class RequisitionUnitDto {
  /** Base units in one requisition unit: "12" for a tray of 12 pieces. Empty or null clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  requisitionUnit?: string | null;
}

export class ItemsQueryDto {
  /** Matches the code or either name, ignoring case. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimmed)
  q?: string;

  /** `active` (the default), `inactive` or `all`. */
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'active';
}

export interface UnitView {
  code: string;
  nameTh: string;
  nameEn: string;
  /** How finely a quantity in this unit is kept: 3 for kg (grams), 0 for pieces. */
  decimals: number;
}

export interface PurchaseUnitView {
  unitCode: string;
  /** Base units in one of this unit, shortest exact form: "10", "22.5". */
  factor: string;
}

export interface ReceivingTolerancesView {
  /** Percent, shortest exact form ("2"), or null for no check. */
  maxVariancePercent: string | null;
  /** °C, shortest exact form ("4"), or null for no check. */
  maxTemperature: string | null;
}

export interface ItemView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
  shelfLifeDays: number;
  active: boolean;
  purchaseUnits: PurchaseUnitView[];
  /** What the receiving dock checks (#11). Not master data: a POS never sees it. */
  receivingTolerances: ReceivingTolerancesView;
  /**
   * Base units the plant packs and sends together (#15), or null. Requisitions are suggested and
   * asked for in whole ones. Not master data: a POS never sees it.
   */
  requisitionUnit: string | null;
  /** The master data version of the item's latest change. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

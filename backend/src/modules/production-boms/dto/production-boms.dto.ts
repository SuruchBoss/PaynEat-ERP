// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { VersionStatus } from '../../../core/time/domain/dated-versions';

/** The ecosystem-wide code shape (docs/GLOSSARY.md). */
export const BOM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
export const BOM_LINES_MAX = 30;

const CODE_MESSAGE =
  'code must be 2–32 capital letters, digits or hyphens, starting with a letter or digit';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upperCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
/** An empty or blank optional decimal means "not given". */
const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text === '' ? null : text;
};

/** The location types that may run a BOM: the plant, in v1 (ADR-0026). */
export const BOM_LOCATION_TYPES = ['plant'] as const;
export type BomLocationType = (typeof BOM_LOCATION_TYPES)[number];

export class BomInputLineDto {
  @IsUUID('4')
  itemId!: string;

  /** Per batch, in the item's base unit, a decimal string. */
  @IsString()
  @Transform(trimmed)
  quantity!: string;

  /** The expected weight per batch in kg; only for items not counted in kg or g. */
  @IsOptional()
  @IsString()
  @Transform(optionalText)
  expectedWeightKg?: string | null;
}

export class BomOutputLineDto extends BomInputLineDto {
  /**
   * An overriding allocation ratio in percent. Give one on every output or on none: without
   * them the ratios are the outputs' shares of expected output weight.
   */
  @IsOptional()
  @IsString()
  @Transform(optionalText)
  allocationRatio?: string | null;
}

export class BomLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOM_LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => BomInputLineDto)
  inputs!: BomInputLineDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOM_LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => BomOutputLineDto)
  outputs!: BomOutputLineDto[];
}

export class CreateBomVersionDto extends BomLinesDto {
  /** The business date it starts on, YYYY-MM-DD (ADR-0018, ADR-0023). */
  @IsString()
  effectiveFrom!: string;
}

export class CreateProductionBomDto extends CreateBomVersionDto {
  /** Upper-cased on the way in; fixed once the BOM exists. */
  @IsString()
  @Transform(upperCode)
  @Matches(BOM_CODE_PATTERN, { message: CODE_MESSAGE })
  code!: string;

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

  @IsIn(BOM_LOCATION_TYPES)
  locationType!: BomLocationType;
}

export class UpdateProductionBomDto {
  /** The revision the change was made from: an edit from an older one is refused. */
  @IsInt()
  @Min(1)
  revision!: number;

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
  active?: boolean;
}

export class ProductionBomsQueryDto {
  /** Include deactivated BOMs. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}

// --- Views --------------------------------------------------------------------------

export interface BomItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
}

export interface BomLineView {
  lineNo: number;
  item: BomItemRef;
  quantity: string;
  /** As stated, for items not counted in kg or g; null otherwise. */
  expectedWeightKg: string | null;
  /** The line's weight per batch in kg, stated or from its quantity, three decimals. */
  weightKg: string;
}

export interface BomOutputView extends BomLineView {
  /** Percent of the batch cost, two decimals. */
  allocationRatio: string;
  /** Share of input weight this output is expected to be, two decimals. */
  yieldPercent: string;
}

export interface BomVersionView {
  id: string;
  number: number;
  effectiveFrom: string;
  status: VersionStatus;
  inputs: BomLineView[];
  outputs: BomOutputView[];
  /** True when the ratios were set by hand rather than by weight share. */
  ratiosOverridden: boolean;
  inputWeightKg: string;
  outputWeightKg: string;
  /** Input weight less expected output weight. It carries no ratio. */
  wasteKg: string;
  /** Expected output weight over input weight, two decimals. */
  yieldPercent: string;
}

export interface ProductionBomSummaryView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  locationType: BomLocationType;
  active: boolean;
  revision: number;
  /** The version in force today, or null when the first one starts later. */
  current: { number: number; effectiveFrom: string; yieldPercent: string } | null;
  /** The next version to start, if any. */
  scheduled: { number: number; effectiveFrom: string } | null;
}

export interface ProductionBomView extends Omit<ProductionBomSummaryView, 'current' | 'scheduled'> {
  /** Today's business date, which decides each version's status. */
  today: string;
  /** Newest first. */
  versions: BomVersionView[];
}

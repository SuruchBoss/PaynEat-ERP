// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import type {
  GenealogyLink,
  PersonRef,
  PostingRule,
  StockDocumentView,
} from '../../ledger/ledger.service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date written YYYY-MM-DD';
export const NOTE_MAX_LENGTH = 500;
export const REASON_MAX_LENGTH = 500;
/** More lots than any real input is taken from. */
export const PICKS_MAX = 50;
export const LINES_MAX = 50;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An empty text is no text. */
const textOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateProductionOrderDto {
  @IsUUID()
  bomId!: string;

  /** The plant that runs it. */
  @IsUUID()
  locationId!: string;

  /** How much of the BOM's first input to use, in its base unit: "500" kg of whole chicken. */
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  plannedQuantity!: string;

  /** Today in the company's time zone when left out; never later than today. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;
}

/** Only what changes, with the revision the planner opened. Drafts only. */
export class UpdateProductionOrderDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  plannedQuantity?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;
}

/** Release, post: at the revision the person reviewed. */
export class ProductionOrderStepDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

export class CancelProductionOrderDto extends ProductionOrderStepDto {
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(trimmed)
  reason!: string;
}

export class ReverseProductionOrderDto {
  /** Today when left out; never before the order's business date, never later than today. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;
}

/** A lot an input is taken from. Quantities are decimal strings (ADR-0019). */
export class PickDto {
  @IsUUID()
  lotId!: string;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  quantity!: string;

  /** Variable-weight items only: the pieces taken, when counted (ADR-0005). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  pieces?: string | null;
}

export class InputActualDto {
  @IsInt()
  @Min(1)
  lineNo!: number;

  /** Replaces the lots the input is taken from. */
  @IsArray()
  @ArrayMaxSize(PICKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PickDto)
  picks!: PickDto[];

  /** Items not counted in kg or g: the measured weight consumed, in kg. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  weightKg?: string | null;
}

export class OutputActualDto {
  @IsInt()
  @Min(1)
  lineNo!: number;

  /** What came out, in the item's base unit; empty when not yet known. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(textOrNull)
  quantity?: string | null;

  /** Variable-weight items: the piece count. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  pieces?: string | null;

  /** Items not counted in kg or g: the measured weight, in kg. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  weightKg?: string | null;
}

/** The lots picked and what came out, recorded on a released order. Lines left out are kept. */
export class RecordActualsDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => InputActualDto)
  inputs?: InputActualDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => OutputActualDto)
  outputs?: OutputActualDto[];
}

export type ProductionOrderStatusFilter = 'all' | 'draft' | 'released' | 'posted' | 'cancelled';

export class ProductionOrdersQueryDto {
  @IsOptional()
  @IsIn(['all', 'draft', 'released', 'posted', 'cancelled'])
  status: ProductionOrderStatusFilter = 'all';

  @IsOptional()
  @IsUUID()
  bomId?: string;
}

export class GenealogyQueryDto {
  /** Include links of orders that were reversed (history), not only those a trace follows. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  includeReversed: boolean = false;
}

// --- Views --------------------------------------------------------------------------------

export interface ItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
  /** Whether a measured weight is recorded for it (it is not counted in kg or g). */
  weighed: boolean;
}

export interface LocationRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
}

export interface BomRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  version: { id: string; number: number; effectiveFrom: string };
}

/** A lot the input could be taken from: stock at the plant now. */
export interface AvailableLotView {
  lotId: string;
  number: string;
  expiryDate: string;
  /** Expired on the order's business date: shown, never pickable (ADR-0006). */
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
  /** quantity × unit cost, exact. */
  value: string;
}

export interface InputLineView {
  lineNo: number;
  item: ItemRef;
  plannedQuantity: string;
  /** Draft: what FEFO would take now. Released and later: what is recorded. */
  picks: PickView[];
  /** The picks as FEFO chose them (false), or changed by the supervisor (true). */
  picksOverridden: boolean;
  /** Draft and released: what the picks do not cover of the plan, "0" when they cover it. */
  shortBy: string | null;
  /** Σ picks. */
  quantity: string;
  weightKg: string | null;
  /** Draft and released: the lots there are to choose from. */
  availableLots: AvailableLotView[];
}

export interface CostView {
  allocatedValue: string;
  unitCost: string;
  lotValue: string;
  roundingDifference: string;
}

export interface OutputLineView {
  lineNo: number;
  item: ItemRef;
  plannedQuantity: string;
  allocationRatio: string;
  actualQuantity: string | null;
  actualPieces: string | null;
  actualWeightKg: string | null;
  yield: { expected: string; actual: string | null; difference: string | null };
  /**
   * Posted: the cost fixed at posting. Before: what posting would give from the lots picked
   * and the quantities recorded so far, or null while that cannot be worked out.
   */
  cost: CostView | null;
  /** The output lot's expiry (ADR-0014): the computed date, capped by the earliest input lot. */
  expiry: {
    expiryDate: string;
    computedExpiryDate: string;
    earliestInputExpiryDate: string;
  } | null;
  /** Posted: the lot it created. */
  lot: { id: string; number: string } | null;
}

/** Why the order cannot post as it stands, in the ledger's rule names; empty when it can. */
export interface PostingCheck {
  rule: PostingRule;
  side?: 'input' | 'output';
  lineNo?: number;
}

export interface ProductionOrderView extends StockDocumentView {
  bom: BomRef;
  location: LocationRef;
  plannedQuantity: string;
  released: { by: PersonRef; at: Date } | null;
  cancelled: { by: PersonRef; at: Date; reason: string } | null;
  inputs: InputLineView[];
  outputs: OutputLineView[];
  yield: { expected: string; actual: string | null; difference: string | null };
  /** Σ picks × lot cost, exact. */
  inputValue: string;
  /** Draft and released: what would refuse posting now. */
  blockers: PostingCheck[];
  /** Posted: genealogy, each output lot to each input lot it consumed (ADR-0006). */
  genealogy: GenealogyLink[];
}

export interface ProductionOrderSummary extends StockDocumentView {
  bom: BomRef;
  location: LocationRef;
  plannedQuantity: string;
  plannedItem: ItemRef;
  yield: { expected: string; actual: string | null; difference: string | null };
}

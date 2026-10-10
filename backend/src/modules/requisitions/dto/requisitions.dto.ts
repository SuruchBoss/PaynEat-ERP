// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
import type { RequisitionStatus } from '../domain/requisition-rules';
import { NOTE_MAX_LENGTH, REASON_MAX_LENGTH } from '../domain/requisition-rules';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date written YYYY-MM-DD';
/** More lines than a branch asks for in one requisition. */
export const LINES_MAX = 100;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An empty text is no text. */
const textOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// --- Requisitions ------------------------------------------------------------------------

/** One item the branch asks for, in its base unit. */
export class RequisitionLineDto {
  @IsUUID()
  itemId!: string;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  requested!: string;
}

export class CreateRequisitionDto {
  /** The branch asking. */
  @IsUUID()
  branchId!: string;

  /** A plant or warehouse; the plant when left out and the company has exactly one. */
  @IsOptional()
  @IsUUID()
  supplyingLocationId?: string;

  /** The day the branch needs the stock by: today or later. */
  @IsString()
  @Matches(ISO_DATE, { message: `neededBy ${DATE_MESSAGE}` })
  neededBy!: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;

  /** May be empty while a draft; a requisition is submitted with at least one line. */
  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineDto)
  lines!: RequisitionLineDto[];
}

/** Only what changes, with the revision the person opened. Drafts only. */
export class UpdateRequisitionDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `neededBy ${DATE_MESSAGE}` })
  neededBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;

  /** Replaces every line. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineDto)
  lines?: RequisitionLineDto[];
}

export class RequisitionStepDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

export class CancelRequisitionDto extends RequisitionStepDto {
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(trimmed)
  reason!: string;
}

/** One item of a transfer logistics creates from a requisition, in its base unit. */
export class RequisitionTransferLineDto {
  @IsUUID()
  itemId!: string;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  quantity!: string;
}

/**
 * A transfer from a submitted requisition (#14, #15). Lines left out are the requisition's
 * outstanding quantities: what was asked for and is neither dispatched nor already in a draft.
 */
export class CreateRequisitionTransferDto extends RequisitionStepDto {
  /** The dispatch date. Today when left out; never later than today. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => RequisitionTransferLineDto)
  lines?: RequisitionTransferLineDto[];
}

export const REQUISITION_STATUS_FILTERS = [
  'all',
  'open',
  'draft',
  'submitted',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
] as const;

export class RequisitionsQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** `open` (submitted or partially fulfilled: logistics' queue), a status, or `all` (the default). */
  @IsOptional()
  @IsIn(REQUISITION_STATUS_FILTERS)
  status: (typeof REQUISITION_STATUS_FILTERS)[number] = 'all';
}

export class SuggestionsQueryDto {
  @IsUUID()
  branchId!: string;
}

export class ParMissesQueryDto {
  /** First business date of the period; four weeks before `to` when left out. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `from ${DATE_MESSAGE}` })
  from?: string;

  /** Last business date of the period; today when left out, never later. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `to ${DATE_MESSAGE}` })
  to?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

// --- Par levels --------------------------------------------------------------------------

export class ParLevelsQueryDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class ParLevelDto {
  /** In the item's base unit; zero is a par level of nothing. */
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  quantity!: string;
}

// --- Views -------------------------------------------------------------------------------

export interface PersonRef {
  id: string;
  displayName: string;
}

export interface ItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
  /** Base units the plant sends together, or null. */
  requisitionUnit: string | null;
}

export interface LocationRef {
  id: string;
  code: string;
  type: string;
  nameTh: string;
  nameEn: string;
}

export interface RequisitionLineView {
  lineNo: number;
  item: ItemRef;
  /** What the screen suggested when the line was saved; null with no par level then. */
  suggested: string | null;
  requested: string;
  /** Left and not reversed, in transfers created from the requisition. */
  dispatched: string;
  /** Planned by its transfers still in draft. */
  drafted: string;
  /** Requested, less dispatched and less drafted, never below zero: what a new transfer takes. */
  outstanding: string;
}

export interface RequisitionTransferRef {
  id: string;
  number: string;
  /** The transfer's status (#14): draft, dispatched, received or reversed. */
  status: string;
  businessDate: string;
}

export interface RequisitionSummary {
  id: string;
  number: string;
  status: RequisitionStatus;
  revision: number;
  branch: LocationRef;
  supplyingLocation: LocationRef;
  neededBy: string;
  lineCount: number;
  createdBy: PersonRef;
  createdAt: Date;
  submittedAt: Date | null;
}

export interface RequisitionView extends Omit<RequisitionSummary, 'lineCount'> {
  note: string | null;
  lines: RequisitionLineView[];
  transfers: RequisitionTransferRef[];
  submitted: { by: PersonRef; at: Date } | null;
  cancelled: { by: PersonRef; at: Date; reason: string } | null;
}

/** One item the branch could ask for, with how its suggestion is made up. */
export interface SuggestionView {
  item: ItemRef;
  /** Null when the item has no par level at the branch: no suggestion. */
  par: string | null;
  /** The branch's balance now, all lots; may be below zero. */
  balance: string;
  /** Dispatched to the branch and not yet received. */
  inTransit: string;
  /** `max(0, par − balance − inTransit)`, rounded up to the requisition unit; null without a par. */
  suggested: string | null;
}

export interface SuggestionsView {
  branch: LocationRef;
  items: SuggestionView[];
}

export interface ParLevelView {
  location: LocationRef;
  item: ItemRef;
  quantity: string;
  updatedBy: PersonRef;
  updatedAt: Date;
}

/** One branch and item over the period, with both kinds of par miss (ADR-0009). */
export interface ParMissRow {
  branch: LocationRef;
  item: ItemRef;
  /** The par level today, or null. */
  par: string | null;
  /** Times the item's balance at the branch went from zero or more to below zero. */
  negativeEpisodes: number;
  /** Requisition lines needed by a date in the period that has passed. */
  linesDue: number;
  /** Of those, the lines not fully dispatched by their needed-by date. */
  linesMissed: number;
}

export interface ParMissesView {
  from: string;
  to: string;
  rows: ParMissRow[];
}

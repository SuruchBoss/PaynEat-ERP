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
import type { Finding } from '../../../core/receiving/domain/inspection';
import type { PersonRef, PostingRule, StockDocumentView } from '../../ledger/ledger.service';
import type { ReceiptStatus, TransferStatus } from '../domain/transfer-rules';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date written YYYY-MM-DD';
export const NOTE_MAX_LENGTH = 500;
export const REASON_MAX_LENGTH = 500;
/** More lines than one truck carries to one branch. */
export const LINES_MAX = 100;
/** More lots than any dispatch takes. */
export const PICKS_MAX = 200;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An empty text is no text. */
const textOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// --- Transfers ---------------------------------------------------------------------------

/** One item the transfer asks for, in its base unit. */
export class TransferLineDto {
  @IsUUID()
  itemId!: string;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  quantity!: string;
}

export class CreateTransferDto {
  /** A plant or warehouse. */
  @IsUUID()
  originId!: string;

  /** A branch or warehouse. */
  @IsUUID()
  destinationId!: string;

  /** The dispatch date. Today in the company's time zone when left out; never later than today. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];
}

/** Only what changes, with the revision the person opened. Drafts only. */
export class UpdateTransferDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsUUID()
  originId?: string;

  @IsOptional()
  @IsUUID()
  destinationId?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;

  /** Replaces every line. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines?: TransferLineDto[];
}

export class TransferStepDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

export class CancelTransferDto extends TransferStepDto {
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(trimmed)
  reason!: string;
}

/** A lot that left on a line, as dispatch confirms it. Quantities are decimal strings. */
export class DispatchPickDto {
  @IsInt()
  @Min(1)
  lineNo!: number;

  @IsUUID()
  lotId!: string;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  quantity!: string;

  /** Variable-weight items: the pieces that left (ADR-0005). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  pieces?: string | null;
}

/** Dispatches a draft at the revision the person reviewed, with the lots that really left. */
export class DispatchTransferDto extends TransferStepDto {
  @IsArray()
  @ArrayMaxSize(PICKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => DispatchPickDto)
  picks!: DispatchPickDto[];
}

export type TransferStatusFilter = 'all' | TransferStatus;

export class TransfersQueryDto {
  @IsOptional()
  @IsIn(['all', 'draft', 'dispatched', 'received', 'cancelled'])
  status: TransferStatusFilter = 'all';

  /** Transfers leaving or arriving at this location. */
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class InTransitQueryDto {
  /** The end of this business date; today when left out. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `asOf ${DATE_MESSAGE}` })
  asOf?: string;
}

// --- Receipts ----------------------------------------------------------------------------

/**
 * One dispatched lot line as it arrived, in the item's base unit. `lineNo` is the transfer's pick
 * number. Pieces are for variable-weight items only.
 */
export class ReceiptLineDto {
  @IsInt()
  @Min(1)
  lineNo!: number;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  received!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  receivedPieces?: string | null;

  /** °C at the back door, when measured. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(textOrNull)
  temperature?: string | null;

  @IsString()
  @MaxLength(20)
  condition!: string;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  accepted!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  acceptedPieces?: string | null;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  returned!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  returnedPieces?: string | null;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  writtenOff!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  writtenOffPieces?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(textOrNull)
  reason?: string | null;
}

/** A receipt records every dispatched lot line, once. */
export class CreateTransferReceiptDto {
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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PICKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}

export class UpdateTransferReceiptDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `businessDate ${DATE_MESSAGE}` })
  businessDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(textOrNull)
  note?: string | null;

  /** Replaces every line. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PICKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines?: ReceiptLineDto[];
}

export class ReceiptStepDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

export class RejectTransferReceiptDto extends ReceiptStepDto {
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(trimmed)
  reason!: string;
}

export type ReceiptStatusFilter = 'all' | ReceiptStatus;

export class TransferReceiptsQueryDto {
  @IsOptional()
  @IsIn(['all', 'draft', 'submitted', 'approved', 'posted', 'rejected'])
  status: ReceiptStatusFilter = 'all';

  @IsOptional()
  @IsUUID()
  transferId?: string;
}

// --- Views -------------------------------------------------------------------------------

export interface ItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
}

export interface LocationRef {
  id: string;
  code: string;
  type: string;
  nameTh: string;
  nameEn: string;
}

/** A lot at the origin the line could take: stock there now. */
export interface AvailableLotView {
  lotId: string;
  number: string;
  expiryDate: string;
  /** Expired on the transfer's business date: shown, never pickable (ADR-0006). */
  expired: boolean;
  unitCost: string;
  available: string;
  availablePieces: string | null;
}

/** How a dispatched lot line ended at the destination, once its receipt posted. */
export interface PickOutcome {
  accepted: string;
  acceptedPieces: string | null;
  returned: string;
  returnedPieces: string | null;
  writtenOff: string;
  writtenOffPieces: string | null;
  /** writtenOff × the lot's cost, exact. */
  writtenOffValue: string;
  reason: string | null;
}

export interface TransferPickView {
  /** The lot line's number on the transfer; null for a draft's suggestion. */
  pickNo: number | null;
  lotId: string;
  number: string;
  expiryDate: string;
  unitCost: string;
  quantity: string;
  pieces: string | null;
  /** Received: how it ended. */
  outcome: PickOutcome | null;
}

export interface TransferLineView {
  lineNo: number;
  item: ItemRef;
  /** What the line asks for. */
  quantity: string;
  /** Draft: what FEFO would take now. Dispatched: the lots that left. */
  picks: TransferPickView[];
  /** Σ picks. */
  dispatched: string;
  /** Draft: what the suggested lots do not cover of what is asked, "0" when they cover it. */
  shortBy: string | null;
  /** Draft: the lots at the origin to choose from. */
  availableLots: AvailableLotView[];
  /** Received: Σ accepted, returned and written off over the line's lots. */
  accepted: string | null;
  returned: string | null;
  writtenOff: string | null;
}

export interface DispatchCheck {
  rule: PostingRule;
  lineNo?: number;
  lotId?: string;
}

export interface ReceiptRef {
  id: string;
  number: string;
  status: ReceiptStatus;
  businessDate: string;
  createdBy: PersonRef;
}

export interface TransferView extends Omit<StockDocumentView, 'status'> {
  status: TransferStatus;
  origin: LocationRef;
  destination: LocationRef;
  /** The origin's in-transit location, where dispatched stock waits. */
  inTransit: LocationRef | null;
  dispatched: { by: PersonRef; at: Date } | null;
  cancelled: { by: PersonRef; at: Date; reason: string } | null;
  /** The receipt that posted: who recorded it, who approved it, when it posted. */
  received: {
    receipt: { id: string; number: string; businessDate: string };
    by: PersonRef;
    approvedBy: PersonRef | null;
    at: Date;
  } | null;
  lines: TransferLineView[];
  /** Draft: what would refuse dispatching the suggested lots now. */
  blockers: DispatchCheck[];
  /** Every receipt raised against it, posted or not. */
  receipts: ReceiptRef[];
}

export interface TransferSummary extends Omit<StockDocumentView, 'status'> {
  status: TransferStatus;
  origin: LocationRef;
  destination: LocationRef;
  lineCount: number;
  receivedBy: { receipt: { id: string; number: string } } | null;
}

export interface ReceiptLineView {
  lineNo: number;
  item: ItemRef;
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
  /** Live while a draft; fixed when submitted for approval. */
  findings: Finding[];
  reasonRequired: boolean;
  /** Dispatched less accepted, returned and written off: "0" when the line is resolved. */
  unresolved: string;
  /** The item's receiving tolerances, so the receiver sees what the inspection compares with. */
  tolerances: { maxVariancePercent: string | null; maxTemperature: string | null };
}

export interface ReceiptCheck {
  rule: PostingRule;
  lineNo?: number;
}

export interface TransferReceiptView extends Omit<StockDocumentView, 'status'> {
  status: ReceiptStatus;
  transfer: {
    id: string;
    number: string;
    status: TransferStatus;
    businessDate: string;
    origin: LocationRef;
    destination: LocationRef;
  };
  location: LocationRef;
  submitted: { by: PersonRef; at: Date } | null;
  approved: { by: PersonRef; at: Date } | null;
  rejected: { by: PersonRef; at: Date; reason: string } | null;
  lines: ReceiptLineView[];
  /** Whether it waits for someone else's approval: a finding or a write-off (ADR-0028). */
  needsApproval: boolean;
  /** Not yet posted or rejected: what would refuse it now. */
  blockers: ReceiptCheck[];
}

/** A step that may post: when the ledger refused the posting, why. */
export interface SteppedTransferReceiptView extends TransferReceiptView {
  postingRefusal: { rule: string; message: string; details: Record<string, unknown> } | null;
}

export interface TransferReceiptSummary extends Omit<StockDocumentView, 'status'> {
  status: ReceiptStatus;
  transfer: { id: string; number: string };
  location: LocationRef;
}

/** What one dispatched, not yet received transfer holds in transit, lot by lot. */
export interface InTransitTransferView {
  transfer: { id: string; number: string; businessDate: string };
  origin: LocationRef;
  destination: LocationRef;
  inTransit: LocationRef;
  lots: Array<{
    item: ItemRef;
    lot: { id: string; number: string; expiryDate: string };
    quantity: string;
    pieces: string | null;
  }>;
}

export interface InTransitView {
  asOf: string;
  transfers: InTransitTransferView[];
}

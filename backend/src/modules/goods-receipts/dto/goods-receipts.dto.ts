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
import type { Finding } from '../../../core/receiving/domain/inspection';
import type { PersonRef, PostingRule, StockDocumentView } from '../../ledger/ledger.service';
import { NOTE_MAX_LENGTH, REASON_MAX_LENGTH } from '../domain/goods-receipt-rules';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date written YYYY-MM-DD';
export const LINES_MAX = 200;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An empty text is no text. */
const textOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * One order line as it arrived. Quantities are decimal strings, never JSON numbers (ADR-0019),
 * in the order line's purchase unit or the item's base unit, whichever the receiver counted in.
 */
export class GoodsReceiptLineDto {
  @IsInt()
  @Min(1)
  purchaseOrderLineNo!: number;

  /** The order line's purchase unit ("case") or the item's base unit ("kg"). */
  @IsString()
  @MaxLength(20)
  unitCode!: string;

  /** What arrived, weighed or counted. */
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  countedQuantity!: string;

  /** How much of it is turned away, in the same unit; "0" when left out. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  rejectedQuantity?: string;

  /** Variable-weight items only: pieces counted, and pieces turned away (ADR-0005). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  countedPieces?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(textOrNull)
  rejectedPieces?: string | null;

  /** °C at the dock: "3.8". */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(textOrNull)
  temperature?: string | null;

  @IsString()
  @MaxLength(20)
  condition!: string;

  /** The date the supplier printed, if any (ADR-0014). */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `supplierExpiry ${DATE_MESSAGE}` })
  supplierExpiry?: string | null;

  /** Why a line outside tolerance should be accepted, or why part of it is turned away. */
  @IsOptional()
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(textOrNull)
  reason?: string | null;
}

export class CreateGoodsReceiptDto {
  @IsUUID()
  purchaseOrderId!: string;

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
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];
}

/** Only what changes, with the revision the receiver opened. `lines` replaces them all. */
export class UpdateGoodsReceiptDto {
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines?: GoodsReceiptLineDto[];
}

/** Submit, approve or post: at the revision the person reviewed. */
export class GoodsReceiptStepDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

export class RejectGoodsReceiptDto extends GoodsReceiptStepDto {
  /** Why it was turned down, for the receiver. */
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(trimmed)
  reason!: string;
}

export class GoodsReceiptsQueryDto {
  @IsOptional()
  @IsIn(['all', 'draft', 'submitted', 'approved', 'posted', 'rejected'])
  status: 'all' | 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected' = 'all';

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;
}

export class SupplierReturnsQueryDto {
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;
}

export interface LocationRef {
  id: string;
  code: string;
  type: string;
  nameTh: string;
  nameEn: string;
}

export interface SupplierRef {
  id: string;
  code: string;
  name: string;
}

export interface OrderRef {
  id: string;
  number: string;
  status: string;
}

export interface ItemRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
}

export interface GoodsReceiptLineView {
  lineNo: number;
  purchaseOrderLineNo: number;
  item: ItemRef;
  /** The unit the receiver counted in, and how many base units one of it is. */
  unit: { code: string; nameTh: string; nameEn: string };
  factor: string;
  /** In the counting unit, as entered. */
  countedQuantity: string;
  rejectedQuantity: string;
  acceptedQuantity: string;
  /** In the item's base unit. */
  countedBaseQuantity: string;
  rejectedBaseQuantity: string;
  acceptedBaseQuantity: string;
  /** Variable-weight items only. */
  countedPieces: string | null;
  rejectedPieces: string | null;
  acceptedPieces: string | null;
  temperature: string | null;
  condition: string;
  reason: string | null;
  /** What was ordered on the order line, in the base unit. */
  orderedBaseQuantity: string;
  /**
   * What the order line still expected when the line was inspected: live for a draft, fixed at
   * submission afterwards. Base unit.
   */
  expectedBaseQuantity: string;
  /** The inspection's findings: live for a draft, fixed at submission afterwards. */
  findings: Finding[];
  /** Both dates and the one the lot takes (ADR-0014). */
  expiry: {
    computedExpiry: string;
    supplierExpiry: string | null;
    expiryDate: string;
    takes: 'computed' | 'supplier';
  };
  /** Per base unit: the order line's cost net of recoverable VAT (ADR-0004). */
  unitCost: string;
  /** Accepted base quantity × unit cost, exact, like every stock value. */
  value: string;
  /**
   * Whether accepting this much would take the order line past what was ordered plus the item's
   * variance limit: refused when submitting and when posting.
   */
  overReceipt: boolean;
  /** The lot the posting created, once posted, if anything was accepted. */
  lot: { id: string; number: string } | null;
}

export interface GoodsReceiptSummary extends StockDocumentView {
  purchaseOrder: OrderRef;
  supplier: SupplierRef;
  location: LocationRef;
  lineCount: number;
  /** Lines with at least one finding. */
  linesWithFindings: number;
  totalValue: string;
}

export interface GoodsReceiptView extends StockDocumentView {
  purchaseOrder: OrderRef;
  supplier: SupplierRef;
  location: LocationRef;
  submitted: { by: PersonRef; at: Date } | null;
  approved: { by: PersonRef; at: Date } | null;
  rejected: { by: PersonRef; at: Date; reason: string } | null;
  /** Whether anything on it is outside tolerance, so it waits for a purchasing approver. */
  needsApproval: boolean;
  lines: GoodsReceiptLineView[];
  totalValue: string;
  /** The return to supplier its posting created, if anything was turned away. */
  supplierReturn: { id: string; number: string } | null;
}

/**
 * The answer to submitting or approving: the receipt, and why the ledger refused to post it if it
 * did. A clean receipt that the ledger refused stays a draft; an approved one stays approved.
 */
export interface SteppedGoodsReceiptView extends GoodsReceiptView {
  postingRefusal: {
    rule: PostingRule;
    message: string;
    details: Record<string, unknown>;
  } | null;
}

/** A preview of lines as they would be saved: findings and expiry as you type. */
export interface GoodsReceiptPreview {
  lines: GoodsReceiptLineView[];
  needsApproval: boolean;
  totalValue: string;
}

export interface SupplierReturnLineView {
  lineNo: number;
  receiptLineNo: number;
  item: ItemRef;
  /** In the item's base unit. */
  quantity: string;
  secondaryQuantity: string | null;
  reason: string;
}

export interface SupplierReturnView {
  id: string;
  number: string;
  goodsReceipt: { id: string; number: string };
  purchaseOrder: { id: string; number: string };
  supplier: SupplierRef;
  businessDate: string;
  createdBy: PersonRef;
  createdAt: Date;
  lines: SupplierReturnLineView[];
}

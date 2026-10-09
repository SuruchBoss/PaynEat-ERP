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
import {
  NOTE_MAX_LENGTH,
  REASON_MAX_LENGTH,
  type PurchaseOrderStatus,
} from '../domain/purchase-order-rules';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date written YYYY-MM-DD';
export const LINES_MAX = 200;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An empty note is no note. */
const noteValue = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export const STATUS_FILTERS = [
  'all',
  'draft',
  'submitted',
  'approved',
  'sent',
  'partially_received',
  'received',
  'rejected',
  'cancelled',
] as const;

export class PurchaseOrdersQueryDto {
  @IsOptional()
  @IsIn(STATUS_FILTERS)
  status: (typeof STATUS_FILTERS)[number] = 'all';

  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

/**
 * One item ordered in one of its purchase units. Quantities, prices and rates are decimal
 * strings, never JSON numbers (ADR-0019): "12", "1284.00", "7".
 */
export class PurchaseOrderLineDto {
  @IsUUID()
  itemId!: string;

  /** One of the item's purchase units: "case". */
  @IsString()
  @MaxLength(32)
  @Transform(trimmed)
  unitCode!: string;

  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  quantity!: string;

  /** Per purchase unit, before VAT. */
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  unitPrice!: string;

  /** Percent: "7". */
  @IsString()
  @MaxLength(10)
  @Transform(trimmed)
  vatRate!: string;

  /** Whether the company claims this VAT back (ADR-0024). */
  @IsBoolean()
  vatRecoverable!: boolean;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId!: string;

  /** A plant or a warehouse. */
  @IsUUID()
  deliveryLocationId!: string;

  /** A business date, today or later. */
  @IsString()
  @Matches(ISO_DATE, { message: `expectedDeliveryDate ${DATE_MESSAGE}` })
  expectedDeliveryDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(noteValue)
  note?: string | null;

  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

/** Only what changes, with the revision the editor was opened at. `lines` replaces them all. */
export class UpdatePurchaseOrderDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  deliveryLocationId?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: `expectedDeliveryDate ${DATE_MESSAGE}` })
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  @Transform(noteValue)
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines?: PurchaseOrderLineDto[];
}

/** Submit, approve or mark sent: at the revision the person reviewed. */
export class PurchaseOrderStepDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

/** Reject or cancel: with a reason for the people who will read the order later. */
export class PurchaseOrderReasonDto extends PurchaseOrderStepDto {
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  @Transform(trimmed)
  reason!: string;
}

export interface PersonRef {
  id: string;
  displayName: string;
}

export interface SupplierRef {
  id: string;
  code: string;
  name: string;
  taxId: string;
}

export interface LocationRef {
  id: string;
  code: string;
  type: string;
  nameTh: string;
  nameEn: string;
}

export interface Money {
  net: string;
  vat: string;
  gross: string;
}

export interface PurchaseOrderLineView {
  lineNo: number;
  item: {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    active: boolean;
    baseUnitCode: string;
  };
  unit: { code: string; nameTh: string; nameEn: string };
  /** Base units in one purchase unit, as the line was saved with. */
  factor: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  vatRecoverable: boolean;
  net: string;
  vat: string;
  gross: string;
  /** In the item's base unit. */
  baseQuantity: string;
  /** Per base unit, net of recoverable VAT: what a goods receipt sets lot cost from. */
  unitCost: string;
  /** Accepted by posted goods receipts so far, in the base unit (#11). */
  receivedQuantity: string;
  /** Turned away at the dock and returned to the supplier so far, in the base unit (#11). */
  returnedQuantity: string;
}

export interface PurchaseOrderSummary {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  revision: number;
  supplier: SupplierRef;
  deliveryLocation: LocationRef;
  expectedDeliveryDate: string;
  lineCount: number;
  totals: Money;
  createdBy: PersonRef;
  createdAt: Date;
}

export interface PurchaseOrderView extends Omit<PurchaseOrderSummary, 'lineCount'> {
  note: string | null;
  submitted: { by: PersonRef; at: Date; approvalThreshold: string } | null;
  /** `by` is null when submitting approved it: its gross total was within the threshold. */
  approved: { by: PersonRef | null; at: Date; automatically: boolean } | null;
  rejected: { by: PersonRef; at: Date; reason: string } | null;
  sent: { by: PersonRef; at: Date } | null;
  cancelled: { by: PersonRef; at: Date; reason: string } | null;
  /**
   * For a draft: the threshold in force now and whether submitting would send it to an approver.
   * After submission: the threshold it was judged against and the outcome.
   */
  approval: { threshold: string; needsApprover: boolean };
  lines: PurchaseOrderLineView[];
}

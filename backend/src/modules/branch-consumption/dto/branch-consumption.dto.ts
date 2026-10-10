// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why a sales event could not become consumption, or is held (docs/TELEMETRY.md, ADR-0030). */
export type SalesEventProblemReason =
  | 'unknown_menu_item'
  | 'unknown_modifier'
  | 'no_recipe_in_effect'
  | 'sold_by_mismatch'
  | 'inactive_ingredient'
  | 'negative_usage'
  | 'sale_time_ahead';

/** Who did something, as people see them. */
export interface PersonRef {
  id: string;
  displayName: string;
}

/** A sales event that failed or is held, with what a person needs to fix it. */
export interface SalesEventProblemView {
  salesEventId: string;
  idempotencyKey: string;
  posInstanceCode: string;
  branch: { id: string; code: string };
  saleTime: Date;
  receivedAt: Date;
  menuItemCode: string;
  quantity: string | null;
  weightKg: string | null;
  modifiers: Array<{ code: string; quantity: string }>;
  outcome: 'failed' | 'held';
  reason: SalesEventProblemReason;
  /** The unknown code, the item no longer in use. */
  detail: Record<string, unknown> | null;
  recordedAt: Date;
  /**
   * Whether a re-process can succeed now (ADR-0030): its master data can be fixed, or its date
   * has come. When it cannot, `notReprocessableBecause` says why.
   */
  reprocessable: boolean;
  notReprocessableBecause: 'sale_date_not_yet' | 'past_sale_without_recipe' | 'not_fixable' | null;
}

export interface ConsumptionLineView {
  lineNo: number;
  item: { id: string; code: string; nameTh: string; nameEn: string; baseUnitCode: string };
  /** Exact theoretical usage, before rounding. */
  usage: string;
  /** What the ledger took. */
  quantity: string;
  lots: Array<{
    id: string;
    number: string;
    quantity: string;
    unitCost: string;
    placeholderCost: 'estimated' | 'unknown' | null;
    expired: boolean;
  }>;
}

/** One sale's branch-consumption document. */
export interface BranchConsumptionView {
  documentId: string;
  number: string;
  status: 'draft' | 'posted';
  businessDate: string;
  saleTime: Date;
  branch: { id: string; code: string; nameTh: string; nameEn: string };
  salesEvent: { id: string; idempotencyKey: string; posInstanceCode: string };
  menuItem: { id: string; code: string; nameTh: string; nameEn: string };
  recipeEffectiveFrom: string;
  shortfall: boolean;
  consumedExpiredLot: boolean;
  placeholder: boolean;
  /** The automatic account, or the person who re-processed the event. */
  postedBy: PersonRef | null;
  postedAt: Date | null;
  lines: ConsumptionLineView[];
}

export interface BranchConsumptionSummary {
  documentId: string;
  number: string;
  saleTime: Date;
  branch: { id: string; code: string };
  menuItemCode: string;
  idempotencyKey: string;
  shortfall: boolean;
  consumedExpiredLot: boolean;
  placeholder: boolean;
}

/** What one run of the processor did (#17). */
export interface ProcessingRunView {
  processed: number;
  failed: number;
  held: number;
  /** Dated after today within the tolerance: left until their day. */
  waiting: number;
  /** Another processor had them. */
  skipped: number;
}

export interface UsageRowView {
  date: string;
  branch: { id: string; code: string; nameTh: string; nameEn: string };
  item: { id: string; code: string; nameTh: string; nameEn: string; baseUnitCode: string };
  quantity: string;
  value: string;
  estimatedCost: boolean;
  unknownCost: boolean;
  consumedExpiredLot: boolean;
}

export class ProblemsQueryDto {
  @IsOptional()
  @IsIn(['failed', 'held'])
  outcome?: 'failed' | 'held';

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ConsumptionsQueryDto {
  @Matches(ISO_DATE, { message: 'from must be a date, YYYY-MM-DD' })
  from!: string;

  @Matches(ISO_DATE, { message: 'to must be a date, YYYY-MM-DD' })
  to!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class UsageQueryDto extends ConsumptionsQueryDto {}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG } from '../../core/config/config.token';
import type { RootConfig } from '../../core/config/configuration';
import { BusinessRuleError, DomainError, NotFoundError } from '../../core/errors/domain.errors';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import {
  formatQuantity,
  normaliseDecimal,
  stockValue,
  sumValues,
} from '../../core/quantity/domain/stock-value';
import { formatMinimal, negate, parseDecimal } from '../../core/quantity/domain/exact-decimal';
import { SequenceService, type SequenceScope } from '../../core/sequence/sequence.service';
import { compareDates, dateIn, isIsoDate } from '../../core/time/domain/business-date';
import { MetricsService } from '../../core/telemetry/metrics.service';
import { labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { ItemsService } from '../items/items.service';
import { LocationsService } from '../locations/locations.service';
import {
  applyMovements,
  businessDateProblem,
  CONFLICT_RULES,
  lockOrder,
  lotNumber,
  netChanges,
  reversalMovements,
  reversalProblem,
  type Balance,
  type LocationType,
  type Movement,
  type PostedEntry,
  type PostingRule,
} from './domain/posting-rules';
import type {
  BalanceDifference,
  DocumentRef,
  GenealogyLink,
  LotView,
  PersonRef,
  StockDocumentStatus,
  StockDocumentType,
  StockDocumentView,
  StockOnHandQueryDto,
  StockOnHandRow,
  StockOnHandView,
} from './dto/ledger.dto';

export type { PostingRule } from './domain/posting-rules';
export type {
  StockDocumentView,
  StockDocumentStatus,
  StockDocumentType,
  LotView,
  DocumentRef,
  PersonRef,
  GenealogyLink,
} from './dto/ledger.dto';

type Tx = Prisma.TransactionClient;

/** What a posting wrote, and the branch lots it left below zero (flagged for a count). */
interface Written {
  entries: number;
  negativeAtBranch: Array<{ lotId: string; locationCode: string; quantity: string }>;
}

const SCOPES: Record<StockDocumentType, SequenceScope> = {
  opening_balance: 'OPENING_BALANCE',
  reversal: 'REVERSAL',
  stock_adjustment: 'STOCK_ADJUSTMENT',
  goods_receipt: 'GOODS_RECEIPT',
  production_order: 'PRODUCTION_ORDER',
  transfer: 'TRANSFER',
  transfer_receipt: 'TRANSFER_RECEIPT',
  branch_consumption: 'BRANCH_CONSUMPTION',
};

/** Long enough for a posting to wait its turn behind another on the same lots. */
const POSTING_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

const REFUSAL_MESSAGES: Record<PostingRule, string> = {
  already_posted: 'This document has already been posted',
  stale_revision:
    'This document was changed by someone else since you opened it. Reload it and try again.',
  empty_document: 'A document with no lines cannot be posted',
  business_date_in_future: 'The business date cannot be later than today',
  inactive_location: 'The location is no longer in use',
  inactive_item: 'An item on this document is no longer in use',
  secondary_quantity_not_allowed: 'A piece count is recorded only for variable-weight items',
  expired_lot: 'A lot on this document had already expired on its business date',
  negative_stock_plant: 'Posting would take a lot below zero at a plant',
  negative_stock_warehouse: 'Posting would take a lot below zero at a warehouse',
  negative_stock_in_transit: 'Posting would take a lot below zero in transit',
  negative_stock_subcontractor: 'Posting would take a lot below zero at a subcontractor',
  not_posted: 'Only a posted document can be reversed',
  reversal_of_reversal: 'A reversal cannot be reversed; post the correct document instead',
  already_reversed: 'This document has already been reversed',
  business_date_before_original: 'A reversal cannot be dated before the document it reverses',
  not_approved: 'Only an approved document can be posted',
  self_approval: 'Nobody approves a document they created; someone else has to approve it',
  order_not_receivable:
    'Goods are received only against an approved or sent purchase order that is not yet fully received',
  temperature_required:
    'This item has a receiving temperature limit: record the temperature at the dock',
  reason_required: 'A line outside tolerance, or with goods turned away, needs a reason',
  expired_on_arrival: 'These goods had already expired when they arrived: they cannot enter stock',
  over_receipt: "This would receive more than was ordered plus the item's variance limit",
  needs_approval:
    'Something on this receipt is now outside tolerance: reload it and submit it again for approval',
  not_released: 'Only a released production order can be posted',
  nothing_picked: 'Every line needs at least one lot to take it from',
  actuals_missing: 'Record what actually came out of every output before posting',
  weight_required:
    'A line not counted in kg or g needs its measured weight, so the yield is measured, not guessed',
  pieces_required: 'A variable-weight line needs its piece count as well as its weight',
  zero_output_quantity:
    'An output with no actual quantity cannot carry a cost: record what came out, or cancel the order',
  cancelled: 'This document was cancelled: nothing can be posted from it',
  transfer_not_dispatched: 'Only a dispatched transfer can be received',
  already_received:
    'This transfer has already been received: a receipt of it has posted, and a correction is an adjustment',
  transfer_reversed:
    'This transfer was reversed: its stock went back to the origin, so it can no longer be received',
  business_date_before_dispatch: 'A transfer cannot be received before the day it was dispatched',
  difference_unresolved:
    'Accepted, returned and written off must add up to exactly what was dispatched: nothing may stay in transit',
};

/**
 * A posting or reversal refused by a rule: 422, or 409 when it lost a race with someone else.
 * `details.rule` is the rule's stable name, which the console translates.
 */
export class PostingRefusedError extends DomainError {
  constructor(
    readonly rule: PostingRule,
    details: Record<string, unknown> = {},
  ) {
    super(
      'POSTING_REFUSED',
      REFUSAL_MESSAGES[rule],
      CONFLICT_RULES.has(rule) ? HttpStatus.CONFLICT : HttpStatus.UNPROCESSABLE_ENTITY,
      { rule, ...details },
    );
  }
}

/** A lot a posting creates, from one document line. */
export interface NewLot {
  lineNo: number;
  itemId: string;
  locationId: string;
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
  /**
   * Received lots only (ADR-0014): the receipt date plus shelf life, and the supplier's date. The
   * lot keeps both; `expiryDate` is the earlier.
   */
  computedExpiryDate?: string;
  supplierExpiryDate?: string | null;
}

/**
 * A change to a lot that already exists, from one document line: signed, in the item's base
 * unit. The ledger carries the lot's own cost on the entry (ADR-0004), never a cost the
 * document type supplies.
 */
export interface LotChange {
  lineNo: number;
  lotId: string;
  itemId: string;
  locationId: string;
  quantity: string;
  secondaryQuantity: string | null;
}

/**
 * A production posting (#13, ADR-0006): the input lots it consumes, the output lots it creates,
 * and the genealogy linking each output lot (by its line) to each input lot it consumed.
 */
export interface ProductionPosting {
  consumed: LotChange[];
  newLots: NewLot[];
  genealogy: Array<{ outputLineNo: number; inputLotId: string; inputQuantity: string }>;
}

/**
 * What a document type hands the ledger to post: the lots to create, the changes to existing
 * lots, both at once for a production order, or why not.
 */
export type PostingPlan =
  | { refusal: { rule: PostingRule; lineNo?: number } }
  | { newLots: NewLot[] }
  | { lotChanges: LotChange[] }
  | { production: ProductionPosting }
  | { consumption: ConsumptionPosting };

/**
 * What a branch consumed (#17, ADR-0030): changes to the branch's own lots, and what goes to the
 * item's placeholder lot at the branch because the branch never held the item. The ledger creates
 * the placeholder the first time one is needed, and carries its cost like any lot's.
 */
export interface ConsumptionPosting {
  lotChanges: LotChange[];
  placeholders: Array<{ lineNo: number; itemId: string; locationId: string; quantity: string }>;
}

/** The lot of an item a location received most recently, whatever is left of it (#17). */
export interface ReceivedLot {
  lotId: string;
  number: string;
  expiryDate: string;
}

/** One day's consumption of one item at one branch, from the ledger (#17). */
export interface ConsumptionUsageRow {
  date: string;
  locationId: string;
  itemId: string;
  /** In the item's base unit, as posted. */
  quantity: string;
  /** Σ quantity × the cost of the lot each part came from, exact (ADR-0004). */
  value: string;
  /** Part of it came from a placeholder lot whose cost is an estimate (ADR-0030). */
  estimatedCost: boolean;
  /** Part of it came from a placeholder lot with no cost known (cost 0). */
  unknownCost: boolean;
  /** Part of it was taken from a lot past its expiry on that day (ADR-0030). */
  consumedExpiredLot: boolean;
}

/** What a posted branch-consumption document took from one lot, for one of its lines (#17). */
export interface ConsumedLot {
  lineNo: number;
  lotId: string;
  lotNumber: string;
  /** Taken, in the item's base unit (positive). */
  quantity: string;
  unitCost: string;
  /** A placeholder lot (ADR-0030): its cost is an estimate, or unknown (0). */
  placeholderCost: 'estimated' | 'unknown' | null;
  /** The lot was past its expiry on the sale date. */
  expired: boolean;
}

/** A document header as the ledger locks it. */
export interface LockedDocument {
  id: string;
  number: string;
  type: StockDocumentType;
  status: StockDocumentStatus;
  businessDate: string;
  revision: number;
  createdById: string;
}

/** A lot with stock at a location, as `lotsAt` reads it. */
export interface StockedLot {
  lotId: string;
  number: string;
  itemId: string;
  expiryDate: string;
  unitCost: string;
  /** In the item's base unit, above zero. */
  available: string;
  availablePieces: string | null;
}

/** The facts a document type needs about a lot, read inside its transaction. */
export interface LotFacts {
  id: string;
  number: string;
  itemId: string;
  unitCost: string;
  expiryDate: string;
}

interface DraftHeader {
  businessDate: string;
  note: string | null;
}

const DOCUMENT_INCLUDE = {
  createdBy: { select: { id: true, displayName: true } },
  postedBy: { select: { id: true, displayName: true } },
  reverses: { select: { id: true, number: true } },
  reversedBy: {
    select: {
      id: true,
      number: true,
      businessDate: true,
      note: true,
      postedAt: true,
      postedBy: { select: { id: true, displayName: true } },
    },
  },
} satisfies Prisma.StockDocumentInclude;

type DocumentRow = Prisma.StockDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

/**
 * The stock ledger (#7, ADR-0003, ADR-0010): the only writer of lots, ledger entries and
 * balances, and only in raw SQL inside one transaction per posting. A document type (opening
 * balances now; receipts, transfers and the rest later) keeps its own lines and asks the ledger
 * to number, post and reverse it. Posting locks the document, then the balance rows of every
 * lot it touches in one order, checks the rules, and writes all entries or none. Every posting
 * and every refusal is logged with the document number and counted by rule (ADR-0011).
 */
/** An item's current lot cost: what a recipe is priced at for its theoretical cost (#16). */
export interface CurrentLotCost {
  /** Per base unit, shortest exact spelling (ADR-0019). */
  unitCost: string;
  lotNumber: string;
  expiryDate: string;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
    private readonly logger: TelemetryLogger,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: RootConfig,
  ) {
    for (const type of Object.keys(SCOPES)) this.metrics.countPosting(type, 'succeeded', '', 0);
    this.metrics.gaugeFromDatabase(
      'erp_negative_branch_balances',
      'Lots below zero at each branch: each one is a flag asking for a stock count (ADR-0003).',
      ['location_code'],
      () => this.negativeBranchBalances(),
    );
  }

  /** Today's date in the company's time zone (ADR-0018). */
  today(): string {
    return dateIn(this.config.app.timeZone, new Date());
  }

  // --- Documents -------------------------------------------------------------------

  /** A new draft, numbered inside the caller's transaction so numbers have no gaps. */
  async createDraft(
    tx: Tx,
    type: StockDocumentType,
    header: DraftHeader,
    actor: AuthenticatedUser,
  ): Promise<DocumentRef & { revision: number }> {
    this.assertBusinessDate(header.businessDate);
    const number = await this.sequences.next(tx, SCOPES[type], this.currentYear());
    const row = await tx.stockDocument.create({
      data: {
        number,
        type,
        businessDate: dateValue(header.businessDate),
        note: header.note,
        createdById: actor.userId,
      },
      select: { id: true, number: true, revision: true },
    });
    return row;
  }

  /**
   * Locks a draft for editing at the revision the editor opened. A posted document is refused:
   * it never changes, and is corrected by a reversal.
   */
  async lockDraft(tx: Tx, id: string, revision: number): Promise<LockedDocument> {
    const doc = await this.lockAt(tx, id, revision);
    if (doc.status === 'posted') {
      throw new DomainError(
        'DOCUMENT_POSTED',
        'A posted document cannot be edited. Reverse it and post a corrected one.',
        HttpStatus.CONFLICT,
      );
    }
    if (doc.status !== 'draft') {
      throw new DomainError(
        'DOCUMENT_NOT_DRAFT',
        'Only a draft can be edited: this document has already been submitted.',
        HttpStatus.CONFLICT,
        { status: doc.status },
      );
    }
    return doc;
  }

  /**
   * Locks a document at the revision the person saw, whatever its status: for a step that
   * moves it on (submitting, approving, rejecting). An older revision is refused.
   */
  async lockAt(tx: Tx, id: string, revision: number): Promise<LockedDocument> {
    const doc = await this.lockDocument(tx, id);
    if (doc.revision !== revision) {
      throw new DomainError(
        'DOCUMENT_CHANGED',
        'This document was changed by someone else since you opened it. Reload it and try again.',
        HttpStatus.CONFLICT,
        { currentRevision: doc.revision },
      );
    }
    return doc;
  }

  /**
   * Moves a locked document to its next status and takes the next revision. The document type
   * decides which moves are allowed; posting is never one of them (only `post` posts).
   */
  async moveTo(
    tx: Tx,
    doc: LockedDocument,
    status: Exclude<StockDocumentStatus, 'posted'>,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE "stock_documents"
      SET "status" = ${status}::"StockDocumentStatus", "revision" = "revision" + 1,
          "updated_at" = now()
      WHERE "id" = ${doc.id}::uuid
    `;
  }

  /** Changes a locked draft's header and takes the next revision. */
  async updateDraft(tx: Tx, doc: LockedDocument, header: Partial<DraftHeader>): Promise<void> {
    if (header.businessDate !== undefined) this.assertBusinessDate(header.businessDate);
    await tx.stockDocument.update({
      where: { id: doc.id },
      data: {
        ...(header.businessDate !== undefined
          ? { businessDate: dateValue(header.businessDate) }
          : {}),
        ...(header.note !== undefined ? { note: header.note } : {}),
        revision: { increment: 1 },
      },
    });
  }

  async document(id: string): Promise<StockDocumentView> {
    const row = await this.prisma.stockDocument.findUnique({
      where: { id },
      include: DOCUMENT_INCLUDE,
    });
    if (!row) throw new NotFoundError('Document', id);
    return toDocumentView(row);
  }

  async documents(ids: readonly string[]): Promise<Map<string, StockDocumentView>> {
    const rows = await this.prisma.stockDocument.findMany({
      where: { id: { in: [...ids] } },
      include: DOCUMENT_INCLUDE,
    });
    return new Map(rows.map((row) => [row.id, toDocumentView(row)]));
  }

  /** The lots a posted document created, by line. */
  async lotsOf(documentId: string): Promise<LotView[]> {
    const rows = await this.prisma.lot.findMany({
      // A placeholder lot is never a document's own (ADR-0030): it only stands in for a branch.
      where: { originDocumentId: documentId, placeholderLocationId: null },
      orderBy: { originLineNo: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      lineNo: row.originLineNo,
      itemId: row.itemId,
      quantity: row.quantity.toFixed(),
      secondaryQuantity: row.secondaryQuantity?.toFixed() ?? null,
      unitCost: normaliseDecimal(row.unitCost.toFixed()),
      expiryDate: dateText(row.expiryDate!),
      computedExpiryDate: row.computedExpiryDate ? dateText(row.computedExpiryDate) : null,
      supplierExpiryDate: row.supplierExpiryDate ? dateText(row.supplierExpiryDate) : null,
    }));
  }

  /** Lots by id, with what a document type needs to check a change to them. */
  async lotFacts(ids: readonly string[], tx: Tx = this.prisma): Promise<Map<string, LotFacts>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.lot.findMany({
      // A placeholder lot is no lot a document type may name (ADR-0030): it is left out, so a
      // document naming one is refused as naming an unknown lot.
      where: { id: { in: [...new Set(ids)] }, placeholderLocationId: null },
      select: { id: true, number: true, itemId: true, unitCost: true, expiryDate: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          number: row.number,
          itemId: row.itemId,
          unitCost: normaliseDecimal(row.unitCost.toFixed()),
          expiryDate: dateText(row.expiryDate!),
        },
      ]),
    );
  }

  /**
   * The lots of these items with stock above zero at a location now, from the balance snapshot,
   * with what FEFO and a person overriding it need: expiry, cost and what is left. Inside a
   * transaction it reads that transaction's view; nothing is locked (posting locks).
   */
  async lotsAt(
    locationId: string,
    itemIds: readonly string[],
    tx: Tx = this.prisma,
  ): Promise<StockedLot[]> {
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return [];
    const rows = await tx.$queryRaw<
      Array<{
        lotId: string;
        number: string;
        itemId: string;
        expiryDate: Date;
        unitCost: string;
        quantity: string;
        secondaryQuantity: string | null;
      }>
    >`
      SELECT l."id" AS "lotId", l."number", l."item_id" AS "itemId", l."expiry_date" AS "expiryDate",
             l."unit_cost"::text AS "unitCost", b."quantity"::text AS "quantity",
             b."secondary_quantity"::text AS "secondaryQuantity"
      FROM "stock_balances" b
      JOIN "lots" l ON l."id" = b."lot_id"
      WHERE b."location_id" = ${locationId}::uuid AND b."item_id" = ANY(${ids}::uuid[])
        AND b."quantity" > 0 AND l."placeholder_location_id" IS NULL
      ORDER BY l."expiry_date", l."number"
    `;
    return rows.map((row) => ({
      lotId: row.lotId,
      number: row.number,
      itemId: row.itemId,
      expiryDate: dateText(row.expiryDate!),
      unitCost: normaliseDecimal(row.unitCost),
      available: normaliseDecimal(row.quantity),
      availablePieces:
        row.secondaryQuantity === null ? null : normaliseDecimal(row.secondaryQuantity),
    }));
  }

  // --- Branch consumption (#17, ADR-0030) ------------------------------------------

  /**
   * Locks every balance row of these items at a location, in the ledger's lock order, so that
   * what a branch-consumption plan reads with `lotsAt` cannot change before it posts. Two
   * processors at the same branch wait for each other here rather than both taking one lot.
   */
  async lockBalancesAt(tx: Tx, locationId: string, itemIds: readonly string[]): Promise<void> {
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return;
    await tx.$queryRaw`
      SELECT 1 FROM "stock_balances"
      WHERE "location_id" = ${locationId}::uuid AND "item_id" = ANY(${ids}::uuid[])
      ORDER BY "lot_id", "location_id"
      FOR UPDATE
    `;
  }

  /**
   * For each of these items, the lot the location received most recently (its latest entry
   * bringing stock in, a reversal excepted), whatever is left of it. Placeholder lots are never
   * one: an item absent from the map was never received there.
   */
  async lastReceivedAt(
    tx: Tx,
    locationId: string,
    itemIds: readonly string[],
  ): Promise<Map<string, ReceivedLot>> {
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<
      Array<{ itemId: string; lotId: string; number: string; expiryDate: Date }>
    >`
      SELECT DISTINCT ON (e."item_id")
             e."item_id" AS "itemId", l."id" AS "lotId", l."number", l."expiry_date" AS "expiryDate"
      FROM "ledger_entries" e
      JOIN "lots" l ON l."id" = e."lot_id"
      WHERE e."location_id" = ${locationId}::uuid AND e."item_id" = ANY(${ids}::uuid[])
        AND e."quantity" > 0 AND e."reverses_entry_id" IS NULL
        AND l."placeholder_location_id" IS NULL
      ORDER BY e."item_id", e."business_time" DESC, e."posted_at" DESC, l."number" DESC
    `;
    return new Map(
      rows.map((row) => [
        row.itemId,
        { lotId: row.lotId, number: row.number, expiryDate: dateText(row.expiryDate) },
      ]),
    );
  }

  /**
   * What branches consumed, by day (the company's time zone), branch and item, read from the
   * ledger entries of branch-consumption documents: the quantity, its value at the cost of each
   * lot it came from, and whether any of it carried an estimated or unknown cost or came from a
   * lot past its expiry that day (ADR-0030).
   */
  async consumptionUsage(input: {
    from: string;
    to: string;
    locationId?: string;
  }): Promise<ConsumptionUsageRow[]> {
    const tz = this.config.app.timeZone;
    const location = input.locationId
      ? Prisma.sql`AND e."location_id" = ${input.locationId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{
        date: string;
        locationId: string;
        itemId: string;
        quantity: string;
        value: string;
        estimatedCost: boolean;
        unknownCost: boolean;
        consumedExpiredLot: boolean;
      }>
    >`
      SELECT to_char((e."business_time" AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS "date",
             e."location_id" AS "locationId", e."item_id" AS "itemId",
             (-SUM(e."quantity"))::text AS "quantity",
             (-SUM(e."quantity" * e."unit_cost"))::text AS "value",
             bool_or(l."placeholder_cost" = 'estimated') AS "estimatedCost",
             bool_or(l."placeholder_cost" = 'unknown') AS "unknownCost",
             bool_or(l."expiry_date" < (e."business_time" AT TIME ZONE ${tz})::date) AS "consumedExpiredLot"
      FROM "ledger_entries" e
      JOIN "stock_documents" d ON d."id" = e."document_id"
      JOIN "lots" l ON l."id" = e."lot_id"
      WHERE d."type" = 'branch_consumption'
        AND e."business_time" >= ${this.startOf(input.from, 0)}
        AND e."business_time" < ${this.startOf(input.to, 1)}
        ${location}
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `;
    return rows.map((row) => ({
      date: row.date,
      locationId: row.locationId,
      itemId: row.itemId,
      quantity: normaliseDecimal(row.quantity),
      value: normaliseDecimal(row.value),
      estimatedCost: row.estimatedCost === true,
      unknownCost: row.unknownCost === true,
      consumedExpiredLot: row.consumedExpiredLot === true,
    }));
  }

  /** What a posted branch-consumption document took, lot by lot, in line order (#17). */
  async consumedLots(documentId: string): Promise<ConsumedLot[]> {
    const tz = this.config.app.timeZone;
    const rows = await this.prisma.$queryRaw<
      Array<{
        lineNo: number;
        lotId: string;
        lotNumber: string;
        quantity: string;
        unitCost: string;
        placeholderCost: 'estimated' | 'unknown' | null;
        expired: boolean | null;
      }>
    >`
      SELECT e."line_no" AS "lineNo", l."id" AS "lotId", l."number" AS "lotNumber",
             (-SUM(e."quantity"))::text AS "quantity", e."unit_cost"::text AS "unitCost",
             l."placeholder_cost"::text AS "placeholderCost",
             bool_or(l."expiry_date" < (e."business_time" AT TIME ZONE ${tz})::date) AS "expired"
      FROM "ledger_entries" e
      JOIN "lots" l ON l."id" = e."lot_id"
      WHERE e."document_id" = ${documentId}::uuid
      GROUP BY e."line_no", l."id", l."number", e."unit_cost", l."placeholder_cost"
      ORDER BY e."line_no", l."number"
    `;
    return rows.map((row) => ({
      lineNo: row.lineNo,
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      quantity: normaliseDecimal(row.quantity),
      unitCost: normaliseDecimal(row.unitCost),
      placeholderCost: row.placeholderCost,
      expired: row.expired === true,
    }));
  }

  /** Which of these lots have ever been held at this location (they have a balance row there). */
  async heldAt(
    locationId: string,
    lotIds: readonly string[],
    tx: Tx = this.prisma,
  ): Promise<Set<string>> {
    if (lotIds.length === 0) return new Set();
    const rows = await tx.stockBalance.findMany({
      where: { locationId, lotId: { in: [...new Set(lotIds)] } },
      select: { lotId: true },
    });
    return new Set(rows.map((row) => row.lotId));
  }

  // --- Posting ---------------------------------------------------------------------

  /**
   * Posts a draft at the revision the person saw: `plan` (the document type's own check, run
   * inside the transaction with the document locked) returns the lots to create or the rule
   * that refuses them. Everything is written in one transaction, or nothing.
   */
  async post(
    documentId: string,
    revision: number,
    actor: AuthenticatedUser,
    plan: (tx: Tx, doc: LockedDocument) => Promise<PostingPlan>,
    options: {
      from: 'draft' | 'approved' | 'released';
      /** The rule that refuses a document not in `from`; `not_approved` unless said. */
      notReady?: PostingRule;
      /**
       * Branch consumption only (#17, ADR-0030): the entries' business time is the sale's own
       * time rather than the start of the business date. It must fall on that date.
       */
      businessTime?: Date;
      /** Run in the same transaction once the document is posted. */
      afterPosting?: (tx: Tx, doc: LockedDocument) => Promise<void>;
    } = { from: 'draft' },
  ): Promise<void> {
    let doc: LockedDocument | undefined;
    let written: Written = { entries: 0, negativeAtBranch: [] };
    try {
      await this.prisma.$transaction(async (tx) => {
        doc = await this.lockDocument(tx, documentId);
        if (doc.status === 'posted') throw new PostingRefusedError('already_posted');
        if (doc.revision !== revision) {
          throw new PostingRefusedError('stale_revision', { currentRevision: doc.revision });
        }
        if (doc.status !== options.from) {
          throw new PostingRefusedError(options.notReady ?? 'not_approved', {
            status: doc.status,
          });
        }
        const prepared = await plan(tx, doc);
        if ('refusal' in prepared) {
          const { rule, lineNo } = prepared.refusal;
          throw new PostingRefusedError(rule, lineNo === undefined ? {} : { lineNo });
        }
        const dateRule = businessDateProblem(doc.businessDate, this.today());
        if (dateRule) throw new PostingRefusedError(dateRule);

        if (
          options.businessTime &&
          dateIn(this.config.app.timeZone, options.businessTime) !== doc.businessDate
        ) {
          throw new Error(`document ${doc.number}: its business time is not on its business date`);
        }
        const at = options.businessTime ?? null;
        let movements: Movement[];
        if ('production' in prepared) {
          const { consumed, newLots, genealogy } = prepared.production;
          const consumption = await this.changesOf(tx, consumed);
          const created = await this.createLots(tx, doc, newLots);
          movements = [...consumption, ...created];
          written = await this.write(tx, doc, movements, actor, at);
          await this.writeGenealogy(tx, doc, created, genealogy);
        } else if ('consumption' in prepared) {
          const { lotChanges, placeholders } = prepared.consumption;
          movements = [
            ...(await this.changesOf(tx, lotChanges)),
            ...(await this.placeholderMovements(tx, doc, placeholders)),
          ].sort((a, b) => a.lineNo - b.lineNo);
          written = await this.write(tx, doc, movements, actor, at);
        } else {
          movements =
            'newLots' in prepared
              ? await this.createLots(tx, doc, prepared.newLots)
              : await this.changesOf(tx, prepared.lotChanges);
          written = await this.write(tx, doc, movements, actor, at);
        }
        await tx.$executeRaw`
          UPDATE "stock_documents"
          SET "status" = 'posted', "posted_by_id" = ${actor.userId}::uuid, "posted_at" = now(),
              "revision" = "revision" + 1, "updated_at" = now()
          WHERE "id" = ${doc.id}::uuid
        `;
        await this.locations.markFirstUse(
          tx,
          [...new Set(movements.map((m) => m.locationId))],
          `posted document ${doc.number}`,
        );
        if (options.afterPosting) await options.afterPosting(tx, doc);
      }, POSTING_TRANSACTION);
    } catch (error) {
      if (error instanceof PostingRefusedError && doc)
        this.recordRefusal(doc.type, doc.number, error);
      throw error;
    }
    this.recordSuccess(doc!.type, doc!.number, written);
  }

  /**
   * Counts and logs a refusal a document type made before asking the ledger to post, under the
   * same metric and event as the ledger's own (docs/TELEMETRY.md): an approval by the person who
   * created the document is refused posting as surely as a lot that would go negative.
   */
  recordTypeRefusal(type: StockDocumentType, number: string, error: PostingRefusedError): void {
    this.recordRefusal(type, number, error);
  }

  /**
   * Reverses a posted document: a new, posted reversal document whose entries negate the
   * original's exactly. Only once, whatever happens concurrently: the original is locked
   * first, so a second request waits, then finds the first one's reversal and is refused
   * (and `reverses_id` is unique besides). A document type that may refuse its own reversal
   * passes `guard`, run in the same transaction once the original is locked: it locks whatever
   * else it needs and throws a PostingRefusedError to refuse. Returns the reversal.
   */
  async reverse(
    documentId: string,
    input: { businessDate?: string; note: string | null },
    actor: AuthenticatedUser,
    guard?: (tx: Tx, original: LockedDocument) => Promise<void>,
  ): Promise<DocumentRef> {
    let original: LockedDocument | undefined;
    let reversal: DocumentRef | undefined;
    let written: Written = { entries: 0, negativeAtBranch: [] };
    try {
      await this.prisma.$transaction(async (tx) => {
        original = await this.lockDocument(tx, documentId);
        const originalEntries = await this.entriesOf(tx, original.id);
        await this.labelLocationOf(tx, originalEntries);

        const today = this.today();
        const businessDate = input.businessDate ?? today;
        if (!isIsoDate(businessDate)) throw invalidDate('businessDate');
        const existing = await tx.$queryRaw<{ number: string }[]>`
          SELECT "number" FROM "stock_documents" WHERE "reverses_id" = ${original.id}::uuid
        `;
        const rule = reversalProblem(
          { ...original, reversedBy: existing[0]?.number ?? null },
          businessDate,
          today,
        );
        if (rule) throw new PostingRefusedError(rule);
        if (guard) await guard(tx, original);

        const number = await this.sequences.next(tx, SCOPES.reversal, this.currentYear());
        const created = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "stock_documents"
            ("id", "number", "type", "status", "business_date", "note", "revision",
             "created_by_id", "posted_by_id", "posted_at", "reverses_id", "created_at", "updated_at")
          VALUES
            (gen_random_uuid(), ${number}, 'reversal', 'posted', ${businessDate}::date, ${input.note}, 1,
             ${actor.userId}::uuid, ${actor.userId}::uuid, now(), ${original.id}::uuid, now(), now())
          RETURNING "id"
        `;
        reversal = { id: created[0].id, number };
        written = await this.write(
          tx,
          { id: reversal.id, number, businessDate },
          reversalMovements(originalEntries),
          actor,
        );
      }, POSTING_TRANSACTION);
    } catch (error) {
      const refusal = error instanceof PostingRefusedError ? error : alreadyReversed(error);
      if (refusal && original) {
        this.recordRefusal('reversal', original.number, refusal);
        throw refusal;
      }
      throw error;
    }
    this.recordSuccess('reversal', reversal!.number, written, original!.number);
    return reversal!;
  }

  // --- Genealogy -------------------------------------------------------------------

  /**
   * Genealogy links (ADR-0006) by the document that wrote them, or touching a lot from either
   * side. A link whose document was reversed stays in history, flagged `reversed`; a trace asks
   * for `current` links only and leaves it out.
   */
  async genealogy(
    filter: { documentId: string } | { lotId: string },
    options: { current: boolean } = { current: false },
  ): Promise<GenealogyLink[]> {
    const where =
      'documentId' in filter
        ? Prisma.sql`g."document_id" = ${filter.documentId}::uuid`
        : Prisma.sql`(g."output_lot_id" = ${filter.lotId}::uuid OR g."input_lot_id" = ${filter.lotId}::uuid)`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        documentId: string;
        documentNumber: string;
        outputLotId: string;
        outputLotNumber: string;
        outputItemId: string;
        inputLotId: string;
        inputLotNumber: string;
        inputItemId: string;
        inputQuantity: string;
        reversed: boolean;
      }>
    >`
      SELECT g."document_id" AS "documentId", d."number" AS "documentNumber",
             o."id" AS "outputLotId", o."number" AS "outputLotNumber", o."item_id" AS "outputItemId",
             i."id" AS "inputLotId", i."number" AS "inputLotNumber", i."item_id" AS "inputItemId",
             g."input_quantity"::text AS "inputQuantity",
             EXISTS (SELECT 1 FROM "stock_documents" r WHERE r."reverses_id" = g."document_id") AS "reversed"
      FROM "lot_genealogy" g
      JOIN "stock_documents" d ON d."id" = g."document_id"
      JOIN "lots" o ON o."id" = g."output_lot_id"
      JOIN "lots" i ON i."id" = g."input_lot_id"
      WHERE ${where}
      ORDER BY d."number", o."number", i."number"
    `;
    return rows
      .filter((row) => !options.current || !row.reversed)
      .map((row) => ({
        document: { id: row.documentId, number: row.documentNumber },
        outputLot: { id: row.outputLotId, number: row.outputLotNumber, itemId: row.outputItemId },
        inputLot: { id: row.inputLotId, number: row.inputLotNumber, itemId: row.inputItemId },
        inputQuantity: normaliseDecimal(row.inputQuantity),
        reversed: row.reversed,
      }));
  }

  // --- Reading stock ---------------------------------------------------------------

  /**
   * Stock on hand as of the end of a business date (ADR-0018), per item, lot and location, with
   * quantity, piece count, cost, value and expiry. Today's answer comes from the balance
   * snapshot; an earlier date is summed from the ledger by business time. Lots with nothing
   * left are left out.
   */
  async stockOnHand(query: StockOnHandQueryDto): Promise<StockOnHandView> {
    const today = this.today();
    const asOf = query.asOf ?? today;
    if (!isIsoDate(asOf)) throw invalidDate('asOf');
    if (compareDates(asOf, today) > 0) {
      throw new BusinessRuleError(
        'AS_OF_IN_FUTURE',
        'Stock on hand is known up to today, not for a date still to come',
      );
    }

    const filters = [
      query.locationId ? Prisma.sql`AND "location_id" = ${query.locationId}::uuid` : Prisma.empty,
      query.itemId ? Prisma.sql`AND "item_id" = ${query.itemId}::uuid` : Prisma.empty,
    ];
    const balances =
      asOf === today
        ? await this.prisma.$queryRaw<Balance[]>`
            SELECT "lot_id" AS "lotId", "item_id" AS "itemId", "location_id" AS "locationId",
                   "quantity"::text AS "quantity", "secondary_quantity"::text AS "secondaryQuantity"
            FROM "stock_balances"
            WHERE ("quantity" <> 0 OR COALESCE("secondary_quantity", 0) <> 0) ${Prisma.join(filters, ' ')}
          `
        : await this.prisma.$queryRaw<Balance[]>`
            SELECT "lot_id" AS "lotId", "item_id" AS "itemId", "location_id" AS "locationId",
                   SUM("quantity")::text AS "quantity",
                   SUM("secondary_quantity")::text AS "secondaryQuantity"
            FROM "ledger_entries"
            WHERE "business_time" < ${this.startOf(asOf, 1)} ${Prisma.join(filters, ' ')}
            GROUP BY "lot_id", "item_id", "location_id"
            HAVING SUM("quantity") <> 0 OR COALESCE(SUM("secondary_quantity"), 0) <> 0
          `;

    const [lots, items, locations] = await Promise.all([
      this.prisma.lot.findMany({
        where: { id: { in: balances.map((b) => b.lotId) } },
        select: {
          id: true,
          number: true,
          expiryDate: true,
          unitCost: true,
          placeholderCost: true,
        },
      }),
      this.items.describe(balances.map((b) => b.itemId)),
      this.locations.describe(balances.map((b) => b.locationId)),
    ]);
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));

    const rows: StockOnHandRow[] = balances.map((balance) => {
      const lot = lotById.get(balance.lotId)!;
      const item = items.get(balance.itemId)!;
      const location = locations.get(balance.locationId)!;
      const unitCost = normaliseDecimal(lot.unitCost.toFixed());
      const expiryDate = lot.expiryDate ? dateText(lot.expiryDate) : null;
      return {
        item: {
          id: item.id,
          code: item.code,
          nameTh: item.nameTh,
          nameEn: item.nameEn,
          baseUnitCode: item.baseUnitCode,
        },
        lot: { id: lot.id, number: lot.number, expiryDate, placeholderCost: lot.placeholderCost },
        location: {
          id: location.id,
          code: location.code,
          type: location.type,
          nameTh: location.nameTh,
          nameEn: location.nameEn,
        },
        quantity: formatQuantity(balance.quantity, item.baseUnitDecimals),
        secondaryQuantity:
          balance.secondaryQuantity === null ? null : formatQuantity(balance.secondaryQuantity, 0),
        unitCost,
        value: stockValue(balance.quantity, unitCost),
        // A placeholder lot has no expiry, so it is never expired (ADR-0030).
        expired: expiryDate !== null && compareDates(expiryDate, asOf) < 0,
        countRecommended: location.type === 'branch' && balance.quantity.startsWith('-'),
      };
    });
    rows.sort(
      (a, b) =>
        a.location.code.localeCompare(b.location.code) ||
        a.item.code.localeCompare(b.item.code) ||
        // Placeholder lots, which have no expiry, after the item's real lots.
        (a.lot.expiryDate ?? '9999-12-31').localeCompare(b.lot.expiryDate ?? '9999-12-31') ||
        a.lot.number.localeCompare(b.lot.number),
    );
    return {
      asOf,
      rows,
      totalValue: sumValues(rows.map((r) => r.value)),
      negativeBranchBalances: rows.filter((r) => r.countRecommended).length,
    };
  }

  /**
   * Each item's balance at one location now, all lots together, keyed by item id (#15): what a
   * branch requisition's suggestion subtracts from the par level. A branch's balance may be below
   * zero (ADR-0003) and is returned as it is. An item never held there is absent.
   */
  async itemBalancesAt(
    locationId: string,
    itemIds: readonly string[],
    tx: Tx = this.prisma,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ itemId: string; quantity: string }>>`
      SELECT "item_id" AS "itemId", SUM("quantity")::text AS "quantity"
      FROM "stock_balances"
      WHERE "location_id" = ${locationId}::uuid AND "item_id" = ANY(${ids}::uuid[])
      GROUP BY "item_id"
    `;
    return new Map(rows.map((row) => [row.itemId, normaliseDecimal(row.quantity)]));
  }

  /**
   * How many times each item's balance at each branch went below zero during a period of
   * business dates (#15, ADR-0009: par misses), keyed `locationId:itemId`. The item's balance at
   * the branch, all lots together, is replayed document by document in business time (and, on
   * one business date, in the order the documents were posted); each time it goes from zero or
   * more to below zero during the period counts once. This is the item-level reading of the
   * negative branch balance flag (#8), which itself is not stored. Pairs that never went below
   * zero are absent.
   */
  async negativeEpisodes(input: {
    from: string;
    to: string;
    locationIds?: readonly string[];
  }): Promise<Map<string, number>> {
    const locationFilter = input.locationIds
      ? Prisma.sql`AND e."location_id" = ANY(${[...input.locationIds]}::uuid[])`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{ locationId: string; itemId: string; episodes: bigint }>
    >`
      WITH moves AS (
        SELECT e."location_id", e."item_id", e."business_time", d."posted_at", d."number",
               SUM(e."quantity") AS "quantity"
        FROM "ledger_entries" e
        JOIN "locations" l ON l."id" = e."location_id"
        JOIN "stock_documents" d ON d."id" = e."document_id"
        WHERE l."type" = 'branch' AND e."business_time" < ${this.startOf(input.to, 1)}
          ${locationFilter}
        GROUP BY e."location_id", e."item_id", e."business_time", d."posted_at", d."number"
      ), running AS (
        SELECT m.*, SUM(m."quantity") OVER (
                 PARTITION BY m."location_id", m."item_id"
                 ORDER BY m."business_time", m."posted_at", m."number"
                 ROWS UNBOUNDED PRECEDING) AS "balance"
        FROM moves m
      ), stepped AS (
        SELECT r.*, LAG(r."balance", 1, 0) OVER (
                 PARTITION BY r."location_id", r."item_id"
                 ORDER BY r."business_time", r."posted_at", r."number") AS "before"
        FROM running r
      )
      SELECT "location_id" AS "locationId", "item_id" AS "itemId", COUNT(*) AS "episodes"
      FROM stepped
      WHERE "balance" < 0 AND "before" >= 0 AND "business_time" >= ${this.startOf(input.from, 0)}
      GROUP BY "location_id", "item_id"
    `;
    return new Map(rows.map((row) => [`${row.locationId}:${row.itemId}`, Number(row.episodes)]));
  }

  /**
   * Each item's current lot cost (#16, docs/GLOSSARY.md): the unit cost of the lot FEFO would
   * take next, which is the unexpired lot with stock left anywhere that expires first, the
   * oldest of those first. It prices a recipe as an estimate; consumption still takes the
   * cost of the lot FEFO picks at its own location and time (ADR-0004). An item with no such
   * lot is absent: it has no current cost, not a cost of zero.
   */
  async currentLotCosts(itemIds: readonly string[]): Promise<Map<string, CurrentLotCost>> {
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ itemId: string; number: string; unitCost: string; expiryDate: Date }>
    >`
      SELECT DISTINCT ON (l."item_id")
             l."item_id" AS "itemId", l."number", l."unit_cost"::text AS "unitCost",
             l."expiry_date" AS "expiryDate"
      FROM "lots" l
      WHERE l."item_id" = ANY(${ids}::uuid[]) AND l."placeholder_location_id" IS NULL
        AND l."expiry_date" >= ${this.today()}::date
        AND EXISTS (
          SELECT 1 FROM "stock_balances" b WHERE b."lot_id" = l."id" AND b."quantity" > 0
        )
      ORDER BY l."item_id", l."expiry_date", l."created_at", l."number"
    `;
    return new Map(
      rows.map((row) => [
        row.itemId,
        {
          unitCost: normaliseDecimal(row.unitCost),
          lotNumber: row.number,
          expiryDate: dateText(row.expiryDate),
        },
      ]),
    );
  }

  /** Where the balance snapshot disagrees with the ledger; empty when they agree. */
  async compareBalances(tx: Tx = this.prisma): Promise<BalanceDifference[]> {
    const rows = await tx.$queryRaw<
      Array<{
        lotId: string;
        locationId: string;
        snapshotQuantity: string | null;
        snapshotSecondary: string | null;
        ledgerQuantity: string | null;
        ledgerSecondary: string | null;
      }>
    >`
      WITH "ledger" AS (
        SELECT "lot_id", "location_id", SUM("quantity") AS "quantity",
               SUM("secondary_quantity") AS "secondary_quantity"
        FROM "ledger_entries" GROUP BY "lot_id", "location_id"
      )
      SELECT COALESCE(b."lot_id", l."lot_id") AS "lotId",
             COALESCE(b."location_id", l."location_id") AS "locationId",
             b."quantity"::text AS "snapshotQuantity", b."secondary_quantity"::text AS "snapshotSecondary",
             l."quantity"::text AS "ledgerQuantity", l."secondary_quantity"::text AS "ledgerSecondary"
      FROM "stock_balances" b
      FULL OUTER JOIN "ledger" l ON l."lot_id" = b."lot_id" AND l."location_id" = b."location_id"
      WHERE b."quantity" IS DISTINCT FROM l."quantity"
         OR b."secondary_quantity" IS DISTINCT FROM l."secondary_quantity"
      ORDER BY 1, 2
    `;
    return rows.map((row) => ({
      lotId: row.lotId,
      locationId: row.locationId,
      snapshot: { quantity: row.snapshotQuantity, secondaryQuantity: row.snapshotSecondary },
      ledger: { quantity: row.ledgerQuantity, secondaryQuantity: row.ledgerSecondary },
    }));
  }

  /**
   * Rebuilds the balance snapshot from the ledger, which wins on any disagreement (ADR-0003).
   * Postings wait while it runs. Returns how many balances there are and how many differed.
   */
  async rebuildBalances(): Promise<{ balances: number; corrected: number }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "stock_balances" IN EXCLUSIVE MODE`;
      const corrected = (await this.compareBalances(tx)).length;
      await tx.$executeRaw`DELETE FROM "stock_balances"`;
      const balances = await tx.$executeRaw`
        INSERT INTO "stock_balances"
          ("lot_id", "item_id", "location_id", "quantity", "secondary_quantity", "updated_at")
        SELECT "lot_id", "item_id", "location_id", SUM("quantity"), SUM("secondary_quantity"), now()
        FROM "ledger_entries"
        GROUP BY "lot_id", "item_id", "location_id"
      `;
      this.logger.write({
        severity: corrected === 0 ? 'INFO' : 'WARNING',
        event: 'app.log',
        message: `Stock balances rebuilt from the ledger: ${balances} balances, ${corrected} corrected`,
      });
      return { balances, corrected };
    }, POSTING_TRANSACTION);
  }

  // --- Internals -------------------------------------------------------------------

  private async lockDocument(tx: Tx, id: string): Promise<LockedDocument> {
    const rows = await tx.$queryRaw<LockedDocument[]>`
      SELECT "id", "number", "type"::text AS "type", "status"::text AS "status",
             to_char("business_date", 'YYYY-MM-DD') AS "businessDate", "revision",
             "created_by_id"::text AS "createdById"
      FROM "stock_documents" WHERE "id" = ${id}::uuid
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundError('Document', id);
    return rows[0];
  }

  /** Creates one lot per new-lot line and returns the movements that bring each in. */
  private async createLots(tx: Tx, doc: LockedDocument, newLots: NewLot[]): Promise<Movement[]> {
    if (newLots.length === 0) return [];
    const created = await tx.$queryRaw<{ id: string; lineNo: number }[]>`
      INSERT INTO "lots"
        ("id", "number", "item_id", "origin_document_id", "origin_line_no", "unit_cost",
         "expiry_date", "computed_expiry_date", "supplier_expiry_date", "quantity",
         "secondary_quantity", "created_at")
      VALUES ${Prisma.join(
        newLots.map(
          (lot) => Prisma.sql`(
            gen_random_uuid(), ${lotNumber(doc.number, lot.lineNo)}, ${lot.itemId}::uuid,
            ${doc.id}::uuid, ${lot.lineNo}, ${lot.unitCost}::numeric, ${lot.expiryDate}::date,
            ${lot.computedExpiryDate ?? null}::date, ${lot.supplierExpiryDate ?? null}::date,
            ${lot.quantity}::numeric, ${lot.secondaryQuantity}::numeric, now()
          )`,
        ),
      )}
      RETURNING "id", "origin_line_no" AS "lineNo"
    `;
    const idByLine = new Map(created.map((row) => [row.lineNo, row.id]));
    return newLots.map((lot) => ({
      lineNo: lot.lineNo,
      lotId: idByLine.get(lot.lineNo)!,
      itemId: lot.itemId,
      locationId: lot.locationId,
      quantity: lot.quantity,
      secondaryQuantity: lot.secondaryQuantity,
      unitCost: lot.unitCost,
    }));
  }

  /** The genealogy links of a production posting, from each created lot to each input lot. */
  private async writeGenealogy(
    tx: Tx,
    doc: LockedDocument,
    created: Movement[],
    links: ProductionPosting['genealogy'],
  ): Promise<void> {
    if (links.length === 0) return;
    const lotByLine = new Map(created.map((m) => [m.lineNo, m.lotId]));
    await tx.$executeRaw`
      INSERT INTO "lot_genealogy"
        ("id", "document_id", "output_lot_id", "input_lot_id", "input_quantity", "created_at")
      VALUES ${Prisma.join(
        links.map((link) => {
          const outputLotId = lotByLine.get(link.outputLineNo);
          if (!outputLotId) throw new Error(`no lot created for line ${link.outputLineNo}`);
          return Prisma.sql`(
            gen_random_uuid(), ${doc.id}::uuid, ${outputLotId}::uuid, ${link.inputLotId}::uuid,
            ${link.inputQuantity}::numeric, now()
          )`;
        }),
      )}
    `;
  }

  /** Movements for changes to existing lots, each carrying its lot's own cost (ADR-0004). */
  private async changesOf(tx: Tx, changes: LotChange[]): Promise<Movement[]> {
    const lots = await this.lotFacts(
      changes.map((c) => c.lotId),
      tx,
    );
    return changes.map((change) => {
      const lot = lots.get(change.lotId);
      if (!lot || lot.itemId !== change.itemId) {
        throw new NotFoundError('Lot', change.lotId);
      }
      return { ...change, unitCost: lot.unitCost };
    });
  }

  /**
   * Movements taking what a branch never held from each item's placeholder lot there, creating
   * the placeholder the first time (ADR-0030): numbered `PH-<branch>-<item>`, holding nothing,
   * no expiry, costed at the item's most recently received lot anywhere in the chain (an
   * estimate), or at 0 with no cost known when the chain never held the item. Its cost is fixed
   * when it is created, like any lot's.
   */
  private async placeholderMovements(
    tx: Tx,
    doc: LockedDocument,
    placeholders: ConsumptionPosting['placeholders'],
  ): Promise<Movement[]> {
    if (placeholders.length === 0) return [];
    const locations = await this.locations.describe(
      placeholders.map((p) => p.locationId),
      tx,
    );
    const items = await this.items.describe(
      placeholders.map((p) => p.itemId),
      tx,
    );
    const movements: Movement[] = [];
    for (const wanted of placeholders) {
      const locationCode = locations.get(wanted.locationId)?.code;
      const itemCode = items.get(wanted.itemId)?.code;
      if (!locationCode) throw new NotFoundError('Location', wanted.locationId);
      if (!itemCode) throw new NotFoundError('Item', wanted.itemId);
      await tx.$executeRaw`
        INSERT INTO "lots"
          ("id", "number", "item_id", "origin_document_id", "origin_line_no", "unit_cost",
           "expiry_date", "quantity", "secondary_quantity", "placeholder_location_id",
           "placeholder_cost", "created_at")
        SELECT gen_random_uuid(), ${`PH-${locationCode}-${itemCode}`}, ${wanted.itemId}::uuid,
               ${doc.id}::uuid, ${wanted.lineNo}, COALESCE(latest."unit_cost", 0), NULL, 0, NULL,
               ${wanted.locationId}::uuid,
               (CASE WHEN latest."unit_cost" IS NULL THEN 'unknown' ELSE 'estimated' END)::"PlaceholderCost",
               now()
        FROM (SELECT NULL) AS one
        LEFT JOIN LATERAL (
          SELECT l."unit_cost" FROM "lots" l
          WHERE l."item_id" = ${wanted.itemId}::uuid AND l."placeholder_location_id" IS NULL
          ORDER BY l."created_at" DESC, l."number" DESC
          LIMIT 1
        ) latest ON true
        ON CONFLICT ("placeholder_location_id", "item_id") DO NOTHING
      `;
      const lot = await tx.lot.findUniqueOrThrow({
        where: {
          placeholderLocationId_itemId: {
            placeholderLocationId: wanted.locationId,
            itemId: wanted.itemId,
          },
        },
        select: { id: true, unitCost: true },
      });
      movements.push({
        lineNo: wanted.lineNo,
        lotId: lot.id,
        itemId: wanted.itemId,
        locationId: wanted.locationId,
        quantity: formatMinimal(negate(parseDecimal(wanted.quantity)!)),
        secondaryQuantity: null,
        unitCost: normaliseDecimal(lot.unitCost.toFixed()),
      });
    }
    return movements;
  }

  /**
   * The heart of posting: lock the balance rows the movements touch, by lot then location
   * (ADR-0003 decision 6), check that no plant, warehouse or in-transit lot goes below zero,
   * then write the entries and the balances. Returns the number of entries written.
   */
  private async write(
    tx: Tx,
    doc: { id: string; number: string; businessDate: string },
    movements: Movement[],
    actor: AuthenticatedUser,
    businessTime: Date | null = null,
  ): Promise<Written> {
    if (movements.length === 0) return { entries: 0, negativeAtBranch: [] };
    const entryTime =
      businessTime === null
        ? this.startOf(doc.businessDate, 0)
        : Prisma.sql`${businessTime}::timestamptz`;
    const keys = lockOrder(netChanges(movements));
    const current = await tx.$queryRaw<Balance[]>`
      SELECT "lot_id" AS "lotId", "item_id" AS "itemId", "location_id" AS "locationId",
             "quantity"::text AS "quantity", "secondary_quantity"::text AS "secondaryQuantity"
      FROM "stock_balances"
      WHERE ("lot_id", "location_id") IN (VALUES ${Prisma.join(
        keys.map((k) => Prisma.sql`(${k.lotId}::uuid, ${k.locationId}::uuid)`),
      )})
      ORDER BY "lot_id", "location_id"
      FOR UPDATE
    `;

    const locations = await this.locations.describe(
      keys.map((k) => k.locationId),
      tx,
    );
    const types = new Map<string, LocationType>([...locations.values()].map((l) => [l.id, l.type]));
    const result = applyMovements(current, movements, types);
    if (!result.ok) {
      // The refusal names the lot as people know it, not only by id (#8).
      const lot = await tx.lot.findUnique({
        where: { id: result.lotId },
        select: { number: true },
      });
      throw new PostingRefusedError(result.rule, {
        lotId: result.lotId,
        lotNumber: lot?.number,
        locationCode: locations.get(result.locationId)?.code,
        quantity: result.quantity,
      });
    }

    await tx.$executeRaw`
      INSERT INTO "ledger_entries"
        ("id", "document_id", "line_no", "item_id", "lot_id", "location_id", "quantity",
         "secondary_quantity", "unit_cost", "business_time", "posted_by_id", "posted_at",
         "reverses_entry_id")
      VALUES ${Prisma.join(
        movements.map(
          (m) => Prisma.sql`(
            gen_random_uuid(), ${doc.id}::uuid, ${m.lineNo}, ${m.itemId}::uuid, ${m.lotId}::uuid,
            ${m.locationId}::uuid, ${m.quantity}::numeric, ${m.secondaryQuantity}::numeric,
            ${m.unitCost}::numeric, ${entryTime}, ${actor.userId}::uuid,
            now(), ${m.reversesEntryId ?? null}::uuid
          )`,
        ),
      )}
    `;
    await tx.$executeRaw`
      INSERT INTO "stock_balances"
        ("lot_id", "item_id", "location_id", "quantity", "secondary_quantity", "updated_at")
      VALUES ${Prisma.join(
        keys.map(
          (k) => Prisma.sql`(
            ${k.lotId}::uuid, ${k.itemId}::uuid, ${k.locationId}::uuid, ${k.quantity}::numeric,
            ${k.secondaryQuantity}::numeric, now()
          )`,
        ),
      )}
      ON CONFLICT ("lot_id", "location_id") DO UPDATE SET
        "quantity" = "stock_balances"."quantity" + EXCLUDED."quantity",
        "secondary_quantity" = CASE
          WHEN "stock_balances"."secondary_quantity" IS NULL THEN EXCLUDED."secondary_quantity"
          WHEN EXCLUDED."secondary_quantity" IS NULL THEN "stock_balances"."secondary_quantity"
          ELSE "stock_balances"."secondary_quantity" + EXCLUDED."secondary_quantity"
        END,
        "updated_at" = now()
    `;
    return {
      entries: movements.length,
      negativeAtBranch: result.negativeAtBranch.map((b) => ({
        lotId: b.lotId,
        locationCode: locations.get(b.locationId)?.code ?? '',
        quantity: b.quantity,
      })),
    };
  }

  private async entriesOf(tx: Tx, documentId: string): Promise<PostedEntry[]> {
    return tx.$queryRaw<PostedEntry[]>`
      SELECT "id", "line_no" AS "lineNo", "lot_id" AS "lotId", "item_id" AS "itemId",
             "location_id" AS "locationId", "quantity"::text AS "quantity",
             "secondary_quantity"::text AS "secondaryQuantity", "unit_cost"::text AS "unitCost"
      FROM "ledger_entries" WHERE "document_id" = ${documentId}::uuid
      ORDER BY "line_no", "id"
    `;
  }

  /** A document at one location labels the rest of the request's lines with its code. */
  private async labelLocationOf(tx: Tx, entries: PostedEntry[]): Promise<void> {
    const ids = [...new Set(entries.map((e) => e.locationId))];
    if (ids.length !== 1) return;
    const location = (await this.locations.describe(ids, tx)).get(ids[0]);
    if (location) labelRequestLocation(location.code);
  }

  /** The instant a business date begins in the company's time zone, `plusDays` later. */
  private startOf(date: string, plusDays: number): Prisma.Sql {
    return Prisma.sql`((${date}::date + ${plusDays}::int)::timestamp AT TIME ZONE ${this.config.app.timeZone})`;
  }

  private currentYear(): number {
    return Number(this.today().slice(0, 4));
  }

  private assertBusinessDate(date: string): void {
    if (!isIsoDate(date)) throw invalidDate('businessDate');
    if (businessDateProblem(date, this.today())) {
      throw new BusinessRuleError(
        'BUSINESS_DATE_IN_FUTURE',
        'The business date cannot be later than today',
      );
    }
  }

  private recordSuccess(
    type: StockDocumentType,
    number: string,
    written: Written,
    reverses?: string,
  ): void {
    this.metrics.countPosting(type, 'succeeded');
    this.logger.write({
      severity: 'INFO',
      event: 'ledger.posting.succeeded',
      message: reverses
        ? `Posted ${number}, reversing ${reverses}: ${written.entries} ledger entries`
        : `Posted ${number}: ${written.entries} ledger entries`,
      labels: { document_number: number },
    });
    // A branch may go below zero; it is allowed, and it is flagged for a count (ADR-0003).
    for (const negative of written.negativeAtBranch) {
      this.logger.write({
        severity: 'WARNING',
        event: 'app.log',
        message: `${number} left a lot at ${negative.locationCode} at ${negative.quantity}: count recommended`,
        labels: { document_number: number, location_code: negative.locationCode },
      });
    }
  }

  /**
   * Lots below zero per branch, read from the database when metrics are scraped
   * (docs/TELEMETRY.md): every active branch reports, at 0 when nothing is negative, so "no
   * flags" reads as 0 and never as a missing series.
   */
  private async negativeBranchBalances(): Promise<
    Array<{ labels: { location_code: string }; value: number }>
  > {
    const negatives = await this.prisma.stockBalance.groupBy({
      by: ['locationId'],
      where: { quantity: { lt: 0 } },
      _count: { _all: true },
    });
    const [branches, described] = await Promise.all([
      this.locations.list({ type: 'branch', status: 'active' } as Parameters<
        LocationsService['list']
      >[0]),
      this.locations.describe(negatives.map((n) => n.locationId)),
    ]);
    const counts = new Map<string, number>(branches.map((b) => [b.code, 0]));
    for (const negative of negatives) {
      const location = described.get(negative.locationId);
      if (location?.type === 'branch') counts.set(location.code, negative._count._all);
    }
    return [...counts].map(([code, value]) => ({ labels: { location_code: code }, value }));
  }

  private recordRefusal(type: StockDocumentType, number: string, error: PostingRefusedError): void {
    this.metrics.countPosting(type, 'refused', error.rule);
    this.logger.write({
      severity: 'WARNING',
      event: 'ledger.posting.refused',
      message: `${type === 'reversal' ? 'Reversal of' : 'Posting of'} ${number} refused: ${error.rule}`,
      labels: { document_number: number, rule: error.rule },
    });
  }
}

/** The unique index on `reverses_id` caught a second reversal the lock did not. */
function alreadyReversed(error: unknown): PostingRefusedError | undefined {
  const text = error instanceof Error ? error.message : '';
  return text.includes('stock_documents_reverses_id_key')
    ? new PostingRefusedError('already_reversed')
    : undefined;
}

function invalidDate(field: string): BusinessRuleError {
  return new BusinessRuleError('INVALID_DATE', `${field} must be a real date written YYYY-MM-DD`, {
    field,
  });
}

/** A DATE column's value for a YYYY-MM-DD business date. */
function dateValue(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** A DATE column read through Prisma (midnight UTC) as YYYY-MM-DD. */
export function dateText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function person(row: { id: string; displayName: string } | null): PersonRef | null {
  return row ? { id: row.id, displayName: row.displayName } : null;
}

function toDocumentView(row: DocumentRow): StockDocumentView {
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    businessDate: dateText(row.businessDate),
    note: row.note,
    revision: row.revision,
    createdBy: person(row.createdBy)!,
    createdAt: row.createdAt,
    postedBy: person(row.postedBy),
    postedAt: row.postedAt,
    reverses: row.reverses,
    reversedBy: row.reversedBy
      ? {
          id: row.reversedBy.id,
          number: row.reversedBy.number,
          businessDate: dateText(row.reversedBy.businessDate),
          note: row.reversedBy.note,
          postedAt: row.reversedBy.postedAt!,
          postedBy: person(row.reversedBy.postedBy)!,
        }
      : null,
  };
}

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
  LotView,
  PersonRef,
  StockDocumentView,
  StockOnHandQueryDto,
  StockOnHandRow,
  StockOnHandView,
} from './dto/ledger.dto';

export type { PostingRule } from './domain/posting-rules';
export type { StockDocumentView, LotView, DocumentRef } from './dto/ledger.dto';

type Tx = Prisma.TransactionClient;
export type StockDocumentType = 'opening_balance' | 'reversal';

const SCOPES: Record<StockDocumentType, SequenceScope> = {
  opening_balance: 'OPENING_BALANCE',
  reversal: 'REVERSAL',
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
}

/** What a document type hands the ledger to post: the lots to create, or why not. */
export type PostingPlan =
  { refusal: { rule: PostingRule; lineNo?: number } } | { newLots: NewLot[] };

/** A document header as the ledger locks it. */
export interface LockedDocument {
  id: string;
  number: string;
  type: StockDocumentType;
  status: 'draft' | 'posted';
  businessDate: string;
  revision: number;
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
  ): Promise<DocumentRef> {
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
      select: { id: true, number: true },
    });
    return row;
  }

  /**
   * Locks a draft for editing at the revision the editor opened. A posted document is refused:
   * it never changes, and is corrected by a reversal.
   */
  async lockDraft(tx: Tx, id: string, revision: number): Promise<LockedDocument> {
    const doc = await this.lockDocument(tx, id);
    if (doc.status === 'posted') {
      throw new DomainError(
        'DOCUMENT_POSTED',
        'A posted document cannot be edited. Reverse it and post a corrected one.',
        HttpStatus.CONFLICT,
      );
    }
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
      where: { originDocumentId: documentId },
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
      expiryDate: dateText(row.expiryDate),
    }));
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
  ): Promise<void> {
    let doc: LockedDocument | undefined;
    let entries = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        doc = await this.lockDocument(tx, documentId);
        if (doc.status === 'posted') throw new PostingRefusedError('already_posted');
        if (doc.revision !== revision) {
          throw new PostingRefusedError('stale_revision', { currentRevision: doc.revision });
        }
        const prepared = await plan(tx, doc);
        if ('refusal' in prepared) {
          const { rule, lineNo } = prepared.refusal;
          throw new PostingRefusedError(rule, lineNo === undefined ? {} : { lineNo });
        }
        const dateRule = businessDateProblem(doc.businessDate, this.today());
        if (dateRule) throw new PostingRefusedError(dateRule);

        const movements = await this.createLots(tx, doc, prepared.newLots);
        entries = await this.write(tx, doc, movements, actor);
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
      }, POSTING_TRANSACTION);
    } catch (error) {
      if (error instanceof PostingRefusedError && doc)
        this.recordRefusal(doc.type, doc.number, error);
      throw error;
    }
    this.recordSuccess(doc!.type, doc!.number, entries);
  }

  /**
   * Reverses a posted document: a new, posted reversal document whose entries negate the
   * original's exactly. Only once, whatever happens concurrently: the original is locked
   * first, so a second request waits, then finds the first one's reversal and is refused
   * (and `reverses_id` is unique besides). Returns the reversal.
   */
  async reverse(
    documentId: string,
    input: { businessDate?: string; note: string | null },
    actor: AuthenticatedUser,
  ): Promise<DocumentRef> {
    let original: LockedDocument | undefined;
    let reversal: DocumentRef | undefined;
    let entries = 0;
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
        entries = await this.write(
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
    this.recordSuccess('reversal', reversal!.number, entries, original!.number);
    return reversal!;
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
        select: { id: true, number: true, expiryDate: true, unitCost: true },
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
      const expiryDate = dateText(lot.expiryDate);
      return {
        item: {
          id: item.id,
          code: item.code,
          nameTh: item.nameTh,
          nameEn: item.nameEn,
          baseUnitCode: item.baseUnitCode,
        },
        lot: { id: lot.id, number: lot.number, expiryDate },
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
        expired: compareDates(expiryDate, asOf) < 0,
      };
    });
    rows.sort(
      (a, b) =>
        a.location.code.localeCompare(b.location.code) ||
        a.item.code.localeCompare(b.item.code) ||
        a.lot.expiryDate.localeCompare(b.lot.expiryDate) ||
        a.lot.number.localeCompare(b.lot.number),
    );
    return { asOf, rows, totalValue: sumValues(rows.map((r) => r.value)) };
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
             to_char("business_date", 'YYYY-MM-DD') AS "businessDate", "revision"
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
         "expiry_date", "quantity", "secondary_quantity", "created_at")
      VALUES ${Prisma.join(
        newLots.map(
          (lot) => Prisma.sql`(
            gen_random_uuid(), ${lotNumber(doc.number, lot.lineNo)}, ${lot.itemId}::uuid,
            ${doc.id}::uuid, ${lot.lineNo}, ${lot.unitCost}::numeric, ${lot.expiryDate}::date,
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
  ): Promise<number> {
    if (movements.length === 0) return 0;
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
      throw new PostingRefusedError(result.rule, {
        lotId: result.lotId,
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
            ${m.unitCost}::numeric, ${this.startOf(doc.businessDate, 0)}, ${actor.userId}::uuid,
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
    return movements.length;
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
    entries: number,
    reverses?: string,
  ): void {
    this.metrics.countPosting(type, 'succeeded');
    this.logger.write({
      severity: 'INFO',
      event: 'ledger.posting.succeeded',
      message: reverses
        ? `Posted ${number}, reversing ${reverses}: ${entries} ledger entries`
        : `Posted ${number}: ${entries} ledger entries`,
      labels: { document_number: number },
    });
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

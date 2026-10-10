// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG } from '../../core/config/config.token';
import type { RootConfig } from '../../core/config/configuration';
import { ConflictError, NotFoundError } from '../../core/errors/domain.errors';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { dateIn } from '../../core/time/domain/business-date';
import { MetricsService } from '../../core/telemetry/metrics.service';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { AuthService } from '../auth/auth.service';
import { CompanyService } from '../company/company.service';
import { ItemsService } from '../items/items.service';
import {
  LedgerService,
  PostingRefusedError,
  type ConsumptionPosting,
  type LockedDocument,
} from '../ledger/ledger.service';
import { LocationsService } from '../locations/locations.service';
import { MenuService } from '../menu/menu.service';
import {
  PosIntegrationService,
  type StoredSalesEvent,
} from '../pos-integration/pos-integration.service';
import {
  allocateAtBranch,
  consumedQuantity,
  reprocessBlock,
  saleTimeDecision,
} from './domain/consumption-rules';
import type {
  BranchConsumptionSummary,
  BranchConsumptionView,
  ConsumptionsQueryDto,
  ProblemsQueryDto,
  ProcessingRunView,
  SalesEventProblemReason,
  SalesEventProblemView,
  UsageQueryDto,
  UsageRowView,
} from './dto/branch-consumption.dto';

type Tx = Prisma.TransactionClient;

/** What became of one attempt to turn a sales event into consumption. */
type Attempt = 'processed' | 'failed' | 'held' | 'waiting' | 'skipped';

/** Events claimed per batch of a run. */
const BATCH = 100;

/**
 * Branch consumption (#17, ADR-0030): every sales event a POS delivered becomes one posted
 * branch-consumption document, taking the ingredients its recipes used from the branch's lots
 * FEFO, at the sale's own time. Owns `branch_consumptions`, `branch_consumption_lines` and
 * `sales_event_processing`; reads and moves sales events only through the POS integration module,
 * and writes stock only through the ledger.
 *
 * Exactly once, whatever runs at the same time: an event is claimed with `SKIP LOCKED`, its
 * document is unique per event, and the ledger refuses to post a document twice.
 */
@Injectable()
export class BranchConsumptionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running?: Promise<ProcessingRunView>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: RootConfig,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly pos: PosIntegrationService,
    private readonly menu: MenuService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
    private readonly company: CompanyService,
    private readonly auth: AuthService,
    private readonly logger: TelemetryLogger,
    private readonly metrics: MetricsService,
  ) {
    metrics.countPosting('branch_consumption', 'succeeded', '', 0);
  }

  onApplicationBootstrap(): void {
    const seconds = this.config.app.salesConsumptionIntervalSeconds;
    if (seconds <= 0) return;
    this.timer = setInterval(() => {
      void this.run().catch((error: unknown) =>
        this.logger.write({
          severity: 'ERROR',
          event: 'app.log',
          message: 'A branch-consumption run failed; the next run tries again',
          error,
        }),
      );
    }, seconds * 1000);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  // --- Processing ------------------------------------------------------------------

  /**
   * One run: every event still received, oldest first, until a batch changes nothing. Runs in
   * one process never overlap; runs in several processes share the work through `SKIP LOCKED`.
   */
  run(): Promise<ProcessingRunView> {
    if (!this.running) {
      this.running = this.runBatches().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  private async runBatches(): Promise<ProcessingRunView> {
    const totals: ProcessingRunView = { processed: 0, failed: 0, held: 0, waiting: 0, skipped: 0 };
    const actor = await this.auth.systemActor(this.prisma);
    const seen = new Set<string>();
    for (;;) {
      const held = await this.heldEventIds();
      const ids = (await this.pos.waitingSalesEventIds(BATCH, [...held, ...seen])).filter(
        (id) => !seen.has(id),
      );
      if (ids.length === 0) break;
      for (const id of ids) {
        seen.add(id);
        totals[await this.processOne(id, actor, { skipLocked: true })] += 1;
      }
      if (ids.length < BATCH) break;
    }
    return totals;
  }

  /**
   * A person asks for a failed or held event to be tried again (ADR-0030): recorded, then tried
   * at once as that person, who posts the consumption if it succeeds.
   */
  async reprocess(
    salesEventId: string,
    actor: AuthenticatedUser,
  ): Promise<SalesEventProblemView | null> {
    const today = this.ledger.today();
    await this.prisma.$transaction(async (tx) => {
      const event = await this.pos.lockSalesEvent(tx, salesEventId, ['received', 'failed'], false);
      if (!event) {
        const exists = (await this.pos.describeSalesEvents([salesEventId], tx)).get(salesEventId);
        if (!exists) throw new NotFoundError('Sales event', salesEventId);
        throw new ConflictError('SALES_EVENT_PROCESSED', 'This sales event is already consumption');
      }
      const latest = await this.latestRow(tx, salesEventId);
      if (!latest || (latest.outcome !== 'failed' && latest.outcome !== 'held')) {
        throw new ConflictError(
          'SALES_EVENT_NOT_REPROCESSABLE',
          'This sales event has not failed and is not held: it is processed on its own',
        );
      }
      const block = reprocessBlock(latest.reason!, this.saleDate(event), today);
      if (block) {
        throw new ConflictError('SALES_EVENT_NOT_REPROCESSABLE', REPROCESS_BLOCKS[block], {
          reason: latest.reason,
          block,
        });
      }
      await tx.salesEventProcessing.create({
        data: { salesEventId, outcome: 'reprocessed', recordedById: actor.userId },
      });
      if (event.status === 'failed')
        await this.pos.setSalesEventStatus(tx, salesEventId, 'received');
    });
    await this.processOne(salesEventId, actor, { skipLocked: false });
    return (await this.problems({})).find((p) => p.salesEventId === salesEventId) ?? null;
  }

  /**
   * One event, as `actor` (the automatic account, or the person re-processing it). First the
   * claim and the draft, in one transaction; then the posting, in the ledger's.
   */
  private async processOne(
    id: string,
    actor: AuthenticatedUser,
    options: { skipLocked: boolean },
  ): Promise<Attempt> {
    const claimed = await this.claim(id, actor, options.skipLocked);
    if (!('documentId' in claimed)) return claimed.attempt;
    const { event, documentId, revision } = claimed;

    try {
      await this.ledger.post(documentId, revision, actor, (tx, doc) => this.plan(tx, doc), {
        from: 'draft',
        businessTime: event.saleTime,
        afterPosting: async (tx, doc) => {
          await this.pos.setSalesEventStatus(tx, event.id, 'processed');
          await tx.salesEventProcessing.create({
            data: {
              salesEventId: event.id,
              outcome: 'processed',
              documentId: doc.id,
              recordedById: actor.userId,
            },
          });
        },
      });
    } catch (error) {
      if (
        error instanceof PostingRefusedError &&
        (error.rule === 'already_posted' || error.rule === 'stale_revision')
      ) {
        return 'skipped';
      }
      throw error;
    }
    this.write(
      event,
      'INFO',
      'sales_event.processed',
      `Sales event ${event.idempotencyKey} became branch consumption`,
    );
    this.metrics.countSalesEvent('processed');
    return 'processed';
  }

  /** Claims the event and judges it; for one that goes ahead, its draft (new or left over). */
  private async claim(
    id: string,
    actor: AuthenticatedUser,
    skipLocked: boolean,
  ): Promise<
    { attempt: Attempt } | { event: StoredSalesEvent; documentId: string; revision: number }
  > {
    const today = this.ledger.today();
    const tolerance = await this.company.saleTimeAheadToleranceMinutes();
    const recorded: Array<{ outcome: 'failed' | 'held'; reason: string; event: StoredSalesEvent }> =
      [];
    const result = await this.prisma.$transaction(async (tx) => {
      const event = await this.pos.lockSalesEvent(tx, id, ['received'], skipLocked);
      if (!event) return { attempt: 'skipped' as const };

      const existing = await tx.branchConsumption.findUnique({
        where: { salesEventId: id },
        select: { documentId: true, document: { select: { status: true, revision: true } } },
      });
      if (existing) {
        // A draft left by a run that stopped before posting: post it now.
        if (existing.document.status !== 'draft') return { attempt: 'skipped' as const };
        return { event, documentId: existing.documentId, revision: existing.document.revision };
      }

      const history = await tx.salesEventProcessing.findMany({
        where: { salesEventId: id },
        orderBy: { recordedAt: 'asc' },
        select: { outcome: true },
      });
      const latest = history.at(-1)?.outcome;
      const reviewed = history.some((row) => row.outcome === 'reprocessed');
      if (latest === 'held') return { attempt: 'skipped' as const };

      const saleDate = this.saleDate(event);
      const decision = saleTimeDecision({
        saleTime: event.saleTime,
        receivedAt: event.receivedAt,
        saleDate,
        today,
        toleranceSeconds: tolerance * 60,
        reviewed,
      });
      if (decision === 'wait') return { attempt: 'waiting' as const };
      if (decision === 'hold') {
        await tx.salesEventProcessing.create({
          data: {
            salesEventId: id,
            outcome: 'held',
            reason: 'sale_time_ahead',
            detail: {
              saleTime: event.saleTime,
              receivedAt: event.receivedAt,
              toleranceMinutes: tolerance,
            },
            recordedById: actor.userId,
          },
        });
        recorded.push({ outcome: 'held', reason: 'sale_time_ahead', event });
        return { attempt: 'held' as const };
      }

      const { menuItemId, usage } = await this.menu.saleUsage(
        {
          menuItemCode: event.menuItemCode,
          quantity: event.quantity,
          weightKg: event.weightKg,
          modifiers: event.modifiers,
          saleDate,
        },
        tx,
      );
      if (!usage.ok) {
        const { ok: _ok, reason, ...detail } = usage;
        await tx.salesEventProcessing.create({
          data: {
            salesEventId: id,
            outcome: 'failed',
            reason,
            detail:
              Object.keys(detail).length > 0 ? (detail as Prisma.InputJsonObject) : Prisma.DbNull,
            recordedById: actor.userId,
          },
        });
        await this.pos.setSalesEventStatus(tx, id, 'failed');
        recorded.push({ outcome: 'failed', reason, event });
        return { attempt: 'failed' as const };
      }

      const facts = await this.items.describe([...usage.usage.keys()], tx);
      const lines = [...usage.usage.entries()]
        .map(([itemId, exact]) => {
          const item = facts.get(itemId)!;
          return {
            itemId,
            code: item.code,
            usage: exact,
            quantity: consumedQuantity(exact, item.baseUnitDecimals),
          };
        })
        .filter((line): line is typeof line & { quantity: string } => line.quantity !== null)
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

      const document = await this.ledger.createDraft(
        tx,
        'branch_consumption',
        { businessDate: saleDate, note: `POS sale ${event.idempotencyKey}` },
        actor,
      );
      await tx.branchConsumption.create({
        data: {
          documentId: document.id,
          salesEventId: id,
          locationId: event.locationId,
          saleTime: event.saleTime,
          menuItemId: menuItemId!,
          recipeEffectiveFrom: new Date(`${usage.menuRecipeEffectiveFrom}T00:00:00Z`),
          lines: {
            create: lines.map((line, index) => ({
              lineNo: index + 1,
              itemId: line.itemId,
              usage: line.usage,
              quantity: line.quantity,
            })),
          },
        },
      });
      return { event, documentId: document.id, revision: document.revision };
    });

    // Logged and counted once the transaction that recorded them has committed.
    for (const problem of recorded) this.recordProblem(problem);
    return result;
  }

  /**
   * The ledger plan of one consumption, inside the posting transaction with the document locked:
   * the branch's balances of its items are locked first, so what FEFO reads is what it takes.
   */
  private async plan(tx: Tx, doc: LockedDocument): Promise<{ consumption: ConsumptionPosting }> {
    const consumption = await tx.branchConsumption.findUniqueOrThrow({
      where: { documentId: doc.id },
      select: {
        locationId: true,
        lines: {
          select: { lineNo: true, itemId: true, quantity: true },
          orderBy: { lineNo: 'asc' },
        },
      },
    });
    const { locationId } = consumption;
    const itemIds = consumption.lines.map((line) => line.itemId);
    await this.ledger.lockBalancesAt(tx, locationId, itemIds);
    const stocked = await this.ledger.lotsAt(locationId, itemIds, tx);
    const lastReceived = await this.ledger.lastReceivedAt(tx, locationId, itemIds);

    const posting: ConsumptionPosting = { lotChanges: [], placeholders: [] };
    let shortfall = false;
    let consumedExpiredLot = false;
    let placeholder = false;
    for (const line of consumption.lines) {
      const quantity = line.quantity.toFixed();
      const allocation = allocateAtBranch(
        stocked.filter((lot) => lot.itemId === line.itemId),
        quantity,
        doc.businessDate,
        lastReceived.get(line.itemId) ?? null,
      );
      for (const pick of allocation.picks) {
        posting.lotChanges.push({
          lineNo: line.lineNo,
          lotId: pick.lotId,
          itemId: line.itemId,
          locationId,
          quantity: `-${pick.quantity}`,
          secondaryQuantity: null,
        });
        shortfall ||= pick.shortfall;
        consumedExpiredLot ||= pick.expired;
      }
      if (allocation.toPlaceholder !== '0') {
        posting.placeholders.push({
          lineNo: line.lineNo,
          itemId: line.itemId,
          locationId,
          quantity: allocation.toPlaceholder,
        });
        shortfall = true;
        placeholder = true;
      }
    }
    await tx.branchConsumption.update({
      where: { documentId: doc.id },
      data: { shortfall, consumedExpiredLot, placeholder },
    });
    return { consumption: posting };
  }

  // --- Reading ---------------------------------------------------------------------

  /** Events that failed or are held, newest problem first, with whether a re-process can help. */
  async problems(query: ProblemsQueryDto): Promise<SalesEventProblemView[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        salesEventId: string;
        outcome: 'failed' | 'held';
        reason: SalesEventProblemReason;
        detail: Record<string, unknown> | null;
        recordedAt: Date;
      }>
    >`
      SELECT * FROM (
        SELECT DISTINCT ON (p."sales_event_id")
               p."sales_event_id" AS "salesEventId", p."outcome"::text AS "outcome",
               p."reason", p."detail", p."recorded_at" AS "recordedAt"
        FROM "sales_event_processing" p
        ORDER BY p."sales_event_id", p."recorded_at" DESC, p."id" DESC
      ) latest
      WHERE latest."outcome" IN ('failed', 'held')
        ${query.outcome ? Prisma.sql`AND latest."outcome" = ${query.outcome}` : Prisma.empty}
      ORDER BY latest."recordedAt" DESC
    `;
    const events = await this.pos.describeSalesEvents(rows.map((row) => row.salesEventId));
    const today = this.ledger.today();
    return rows
      .map((row) => ({ row, event: events.get(row.salesEventId)! }))
      .filter(({ event }) => !query.branchId || event.locationId === query.branchId)
      .map(({ row, event }) => {
        const block = reprocessBlock(row.reason, this.saleDate(event), today);
        return {
          salesEventId: event.id,
          idempotencyKey: event.idempotencyKey,
          posInstanceCode: event.posInstanceCode,
          branch: { id: event.locationId, code: event.locationCode },
          saleTime: event.saleTime,
          receivedAt: event.receivedAt,
          menuItemCode: event.menuItemCode,
          quantity: event.quantity,
          weightKg: event.weightKg,
          modifiers: event.modifiers,
          outcome: row.outcome,
          reason: row.reason,
          detail: row.detail,
          recordedAt: row.recordedAt,
          reprocessable: block === null,
          notReprocessableBecause: block,
        };
      });
  }

  /** Posted consumption documents of a period, newest sale first. */
  async list(query: ConsumptionsQueryDto): Promise<BranchConsumptionSummary[]> {
    const rows = await this.prisma.branchConsumption.findMany({
      where: {
        document: {
          status: 'posted',
          businessDate: { gte: dateValue(query.from), lte: dateValue(query.to) },
        },
        ...(query.branchId ? { locationId: query.branchId } : {}),
      },
      select: {
        documentId: true,
        saleTime: true,
        locationId: true,
        shortfall: true,
        consumedExpiredLot: true,
        placeholder: true,
        salesEventId: true,
        menuItem: { select: { code: true } },
        document: { select: { number: true } },
      },
      orderBy: [{ saleTime: 'desc' }, { documentId: 'asc' }],
      take: 500,
    });
    const [events, branches] = await Promise.all([
      this.pos.describeSalesEvents(rows.map((row) => row.salesEventId)),
      this.locations.describe(rows.map((row) => row.locationId)),
    ]);
    return rows.map((row) => ({
      documentId: row.documentId,
      number: row.document.number,
      saleTime: row.saleTime,
      branch: { id: row.locationId, code: branches.get(row.locationId)?.code ?? '' },
      menuItemCode: row.menuItem.code,
      idempotencyKey: events.get(row.salesEventId)?.idempotencyKey ?? '',
      shortfall: row.shortfall,
      consumedExpiredLot: row.consumedExpiredLot,
      placeholder: row.placeholder,
    }));
  }

  async get(documentId: string): Promise<BranchConsumptionView> {
    const row = await this.prisma.branchConsumption.findUnique({
      where: { documentId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!row) throw new NotFoundError('Branch consumption', documentId);
    const [document, events, branches, menuItem, facts, consumed] = await Promise.all([
      this.ledger.document(documentId),
      this.pos.describeSalesEvents([row.salesEventId]),
      this.locations.describe([row.locationId]),
      this.menu.describeMenuItem(row.menuItemId),
      this.items.describe(row.lines.map((line) => line.itemId)),
      this.ledger.consumedLots(documentId),
    ]);
    const event = events.get(row.salesEventId)!;
    const branch = branches.get(row.locationId)!;
    return {
      documentId,
      number: document.number,
      status: document.status === 'posted' ? 'posted' : 'draft',
      businessDate: document.businessDate,
      saleTime: row.saleTime,
      branch: { id: branch.id, code: branch.code, nameTh: branch.nameTh, nameEn: branch.nameEn },
      salesEvent: {
        id: event.id,
        idempotencyKey: event.idempotencyKey,
        posInstanceCode: event.posInstanceCode,
      },
      menuItem: {
        id: menuItem.id,
        code: menuItem.code,
        nameTh: menuItem.nameTh,
        nameEn: menuItem.nameEn,
      },
      recipeEffectiveFrom: dateText(row.recipeEffectiveFrom),
      shortfall: row.shortfall,
      consumedExpiredLot: row.consumedExpiredLot,
      placeholder: row.placeholder,
      postedBy: document.postedBy,
      postedAt: document.postedAt,
      lines: row.lines.map((line) => {
        const item = facts.get(line.itemId)!;
        return {
          lineNo: line.lineNo,
          item: {
            id: item.id,
            code: item.code,
            nameTh: item.nameTh,
            nameEn: item.nameEn,
            baseUnitCode: item.baseUnitCode,
          },
          usage: line.usage.toFixed(),
          quantity: line.quantity.toFixed(),
          lots: consumed
            .filter((lot) => lot.lineNo === line.lineNo)
            .map((lot) => ({
              id: lot.lotId,
              number: lot.lotNumber,
              quantity: lot.quantity,
              unitCost: lot.unitCost,
              placeholderCost: lot.placeholderCost,
              expired: lot.expired,
            })),
        };
      }),
    };
  }

  /**
   * What branches consumed, by day, branch and item, from the ledger: the theoretical usage of
   * what was sold, valued at the lots it came from, with every estimate and expired lot flagged.
   */
  async usage(query: UsageQueryDto): Promise<UsageRowView[]> {
    const rows = await this.ledger.consumptionUsage({
      from: query.from,
      to: query.to,
      locationId: query.branchId,
    });
    const [branches, facts] = await Promise.all([
      this.locations.describe(rows.map((row) => row.locationId)),
      this.items.describe(rows.map((row) => row.itemId)),
    ]);
    return rows.map((row) => {
      const branch = branches.get(row.locationId)!;
      const item = facts.get(row.itemId)!;
      return {
        date: row.date,
        branch: { id: branch.id, code: branch.code, nameTh: branch.nameTh, nameEn: branch.nameEn },
        item: {
          id: item.id,
          code: item.code,
          nameTh: item.nameTh,
          nameEn: item.nameEn,
          baseUnitCode: item.baseUnitCode,
        },
        quantity: row.quantity,
        value: row.value,
        estimatedCost: row.estimatedCost,
        unknownCost: row.unknownCost,
        consumedExpiredLot: row.consumedExpiredLot,
      };
    });
  }

  // --- Internals -------------------------------------------------------------------

  /** Events whose latest attempt held them for a person: the processor leaves them alone. */
  private async heldEventIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT latest."sales_event_id" AS "id" FROM (
        SELECT DISTINCT ON ("sales_event_id") "sales_event_id", "outcome"
        FROM "sales_event_processing"
        ORDER BY "sales_event_id", "recorded_at" DESC, "id" DESC
      ) latest
      WHERE latest."outcome" = 'held'
    `;
    return rows.map((row) => row.id);
  }

  private async latestRow(
    tx: Tx,
    salesEventId: string,
  ): Promise<{ outcome: string; reason: string | null } | null> {
    return tx.salesEventProcessing.findFirst({
      where: { salesEventId },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: { outcome: true, reason: true },
    });
  }

  private saleDate(event: StoredSalesEvent): string {
    return dateIn(this.config.app.timeZone, event.saleTime);
  }

  /** A failed or held event, logged and counted once, when it is recorded. */
  private recordProblem(problem: {
    outcome: 'failed' | 'held';
    reason: string;
    event: StoredSalesEvent;
  }): void {
    const { outcome, reason, event } = problem;
    this.write(
      event,
      'WARNING',
      `sales_event.${outcome}`,
      outcome === 'held'
        ? `Sales event ${event.idempotencyKey} is held: its sale time is too far ahead of its receipt`
        : `Sales event ${event.idempotencyKey} could not become consumption: ${reason}`,
      reason,
    );
    this.metrics.countSalesEvent(outcome, reason);
  }

  private write(
    event: StoredSalesEvent,
    severity: 'INFO' | 'WARNING',
    name: string,
    message: string,
    reason?: string,
  ): void {
    this.logger.write({
      severity,
      event: name,
      message,
      labels: {
        pos_instance: event.posInstanceCode,
        location_code: event.locationCode,
        ...(reason ? { reason } : {}),
      },
      // The idempotency key is the event's correlation id, here as at ingest (docs/TELEMETRY.md).
      correlationId: event.idempotencyKey,
    });
  }
}

const REPROCESS_BLOCKS = {
  sale_date_not_yet: 'The sale is dated after today; it can be re-processed once its date has come',
  past_sale_without_recipe:
    'A recipe never starts in the past, so a sale from an earlier day without one stays failed',
  not_fixable: 'This problem cannot be fixed for a sale that already happened',
} as const;

function dateValue(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function dateText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

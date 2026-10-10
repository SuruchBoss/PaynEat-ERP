// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { BusinessRuleError, DomainError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  formatMinimal,
  negate,
  parseDecimal,
  sign,
  type ExactDecimal,
} from '../../core/quantity/domain/exact-decimal';
import { normaliseDecimal, stockValue } from '../../core/quantity/domain/stock-value';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { fefoOrder, fefoPick, isExpired } from '../../core/stock/domain/fefo';
import { compareDates, isIsoDate } from '../../core/time/domain/business-date';
import { MetricsService } from '../../core/telemetry/metrics.service';
import { labelRequestDocument, labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { AuditService } from '../audit/audit.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import {
  LedgerService,
  PostingRefusedError,
  type DocumentRef,
  type LockedDocument,
  type LotChange,
  type LotFacts,
  type PostingPlan,
  type StockDocumentView,
  type StockedLot,
} from '../ledger/ledger.service';
import { LocationsService, type LocationFacts } from '../locations/locations.service';
import {
  dispatchBlockers,
  dispatchReversalRefusal,
  piecesValid,
  positiveQuantityProblem,
  routeProblem,
  shortBy,
  total,
  transferStatus,
  type DispatchPick,
  type RouteProblem,
  type TransferStatus,
} from './domain/transfer-rules';
import type {
  AvailableLotView,
  CancelTransferDto,
  CreateTransferDto,
  DispatchCheck,
  DispatchTransferDto,
  InTransitQueryDto,
  InTransitView,
  ItemRef,
  LocationRef,
  PickOutcome,
  ReceiptRef,
  ReverseTransferDto,
  TransferLineDto,
  TransferLineView,
  TransferPickView,
  TransferSummary,
  TransferView,
  TransfersQueryDto,
  UpdateTransferDto,
} from './dto/transfers.dto';

type Tx = Prisma.TransactionClient;

const ROUTE_ERRORS: Record<RouteProblem, string> = {
  ORIGIN_NOT_PLANT_OR_WAREHOUSE: 'Stock is transferred out of a plant or a warehouse',
  DESTINATION_NOT_BRANCH_OR_WAREHOUSE: 'Stock is transferred to a branch or a warehouse',
  SAME_LOCATION: 'A transfer goes somewhere else than where it starts',
  ORIGIN_INACTIVE: 'The origin is no longer in use',
  DESTINATION_INACTIVE: 'The destination is no longer in use',
};

const PERSON = { select: { id: true, displayName: true } } as const;

const TRANSFER_INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  picks: { orderBy: { pickNo: 'asc' } },
  cancelledBy: PERSON,
} satisfies Prisma.TransferInclude;

type TransferRow = Prisma.TransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

/** A posted receipt's lines, as the transfer shows how each lot line ended. */
const OUTCOME_SELECT = {
  lineNo: true,
  accepted: true,
  acceptedPieces: true,
  returned: true,
  returnedPieces: true,
  writtenOff: true,
  writtenOffPieces: true,
  reason: true,
} satisfies Prisma.TransferReceiptLineSelect;

/**
 * Transfers (#14; ADR-0007, ADR-0028). Logistics drafts one from a plant or warehouse to a branch
 * or warehouse with the items it asks for; dispatching it confirms the lots that really left,
 * which FEFO suggests and the person may change, never to a lot expired on the transfer's business
 * date, and the ledger moves them from the origin to the origin's in-transit location in one
 * transaction, refusing any that would take the origin below zero. Cost and expiry travel with
 * the lot unchanged (ADR-0004, ADR-0014). The receipt at the destination is the transfer receipts
 * module's; until one posts, what the transfer dispatched is exactly what it holds in transit.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
    metrics: MetricsService,
  ) {
    metrics.gaugeFromDatabase(
      'erp_transfers_in_transit',
      'Transfers dispatched from each origin and not yet received (ADR-0007): stock on the road.',
      ['origin_code'],
      async () =>
        (await this.inTransitByOrigin()).map((o) => ({
          labels: { origin_code: o.originCode },
          value: o.count,
        })),
    );
    metrics.gaugeFromDatabase(
      'erp_transfers_oldest_in_transit_age_seconds',
      'Seconds since the oldest transfer still in transit from each origin was dispatched.',
      ['origin_code'],
      async () =>
        (await this.inTransitByOrigin()).map((o) => ({
          labels: { origin_code: o.originCode },
          value: o.oldestAgeSeconds,
        })),
    );
  }

  // --- reading ---------------------------------------------------------------------

  async list(query: TransfersQueryDto): Promise<TransferSummary[]> {
    const rows = await this.prisma.transfer.findMany({
      where: query.locationId
        ? { OR: [{ originId: query.locationId }, { destinationId: query.locationId }] }
        : {},
      select: {
        documentId: true,
        originId: true,
        destinationId: true,
        receiptDocumentId: true,
        _count: { select: { lines: true } },
      },
    });
    const [documents, receipts, locations] = await Promise.all([
      this.ledger.documents(rows.map((r) => r.documentId)),
      this.ledger.documents(
        rows.flatMap((r) => (r.receiptDocumentId ? [r.receiptDocumentId] : [])),
      ),
      this.locations.describe(rows.flatMap((r) => [r.originId, r.destinationId])),
    ]);
    return rows
      .map((row) => {
        const document = documents.get(row.documentId)!;
        const receipt = row.receiptDocumentId ? receipts.get(row.receiptDocumentId)! : null;
        return {
          ...document,
          status: statusOf(document, receipt !== null),
          origin: locationRef(locations.get(row.originId)!),
          destination: locationRef(locations.get(row.destinationId)!),
          lineCount: row._count.lines,
          receivedBy: receipt ? { receipt: { id: receipt.id, number: receipt.number } } : null,
        };
      })
      .filter((t) => query.status === 'all' || t.status === query.status)
      .sort((a, b) => b.number.localeCompare(a.number));
  }

  async get(id: string, label = true): Promise<TransferView> {
    const row = await this.prisma.transfer.findUnique({
      where: { documentId: id },
      include: TRANSFER_INCLUDE,
    });
    if (!row) throw new NotFoundError('Transfer', id);
    const document = await this.ledger.document(id);
    const [locations, inTransit, items] = await Promise.all([
      this.locations.describe([row.originId, row.destinationId]),
      this.locations.inTransitOf([row.originId]),
      this.items.describe(row.lines.map((l) => l.itemId)),
    ]);
    const origin = locations.get(row.originId)!;
    const destination = locations.get(row.destinationId)!;
    if (label) {
      labelRequestDocument(document.number);
      labelRequestLocation(origin.code);
    }
    const draft = document.status === 'draft';
    const available = draft
      ? await this.ledger.lotsAt(
          row.originId,
          row.lines.map((l) => l.itemId),
        )
      : [];

    // A draft shows what FEFO would take now; later the transfer shows what left.
    const pickRows: DispatchPick[] = draft
      ? suggestedPicks(row, available, document.businessDate)
      : row.picks.map((p) => ({
          lineNo: p.lineNo,
          lotId: p.lotId,
          quantity: normaliseDecimal(p.quantity.toFixed()),
          pieces: p.secondaryQuantity?.toFixed() ?? null,
        }));
    const facts = await this.ledger.lotFacts(pickRows.map((p) => p.lotId));

    const [receipts, outcomes] = await Promise.all([
      this.receiptsOf(id),
      row.receiptDocumentId
        ? this.prisma.transferReceiptLine.findMany({
            where: { documentId: row.receiptDocumentId },
            select: OUTCOME_SELECT,
          })
        : Promise.resolve([]),
    ]);
    const outcomeByPick = new Map(outcomes.map((o) => [o.lineNo, o]));
    const receiptView = row.receiptDocumentId ? await this.receivedBy(row.receiptDocumentId) : null;

    const lines: TransferLineView[] = row.lines.map((line) => {
      const item = items.get(line.itemId)!;
      const picks = pickRows
        .map((p, index) => ({ ...p, pickNo: draft ? null : row.picks[index].pickNo }))
        .filter((p) => p.lineNo === line.lineNo)
        .map((p) =>
          pickView(
            p,
            facts.get(p.lotId)!,
            p.pickNo === null ? undefined : outcomeByPick.get(p.pickNo),
          ),
        );
      const quantity = normaliseDecimal(line.quantity.toFixed());
      const dispatched = total(picks.map((p) => p.quantity));
      const received = receiptView !== null;
      return {
        lineNo: line.lineNo,
        item: itemRef(item),
        quantity,
        picks,
        dispatched,
        shortBy: draft
          ? shortBy(
              quantity,
              picks.map((p) => p.quantity),
            )
          : null,
        availableLots: draft
          ? available
              .filter((lot) => lot.itemId === line.itemId)
              .map((lot) => availableView(lot, document.businessDate))
          : [],
        accepted: received ? total(picks.map((p) => p.outcome?.accepted ?? '0')) : null,
        returned: received ? total(picks.map((p) => p.outcome?.returned ?? '0')) : null,
        writtenOff: received ? total(picks.map((p) => p.outcome?.writtenOff ?? '0')) : null,
      };
    });

    const blockers: DispatchCheck[] = draft
      ? dispatchBlockers({
          businessDate: document.businessDate,
          locationsActive: origin.active && destination.active,
          lines: row.lines.map((l) => ({ lineNo: l.lineNo, item: items.get(l.itemId)! })),
          picks: pickRows,
          lots: facts,
        })
      : [];

    return {
      ...document,
      status: statusOf(document, row.receiptDocumentId !== null),
      origin: locationRef(origin),
      destination: locationRef(destination),
      inTransit: inTransit.get(row.originId) ? locationRef(inTransit.get(row.originId)!) : null,
      dispatched:
        document.status === 'posted' ? { by: document.postedBy!, at: document.postedAt! } : null,
      cancelled: row.cancelledBy
        ? { by: row.cancelledBy, at: row.cancelledAt!, reason: row.cancellationReason! }
        : null,
      received: receiptView,
      reversed: document.reversedBy
        ? {
            reversal: {
              id: document.reversedBy.id,
              number: document.reversedBy.number,
              businessDate: document.reversedBy.businessDate,
            },
            by: document.reversedBy.postedBy,
            at: document.reversedBy.postedAt,
            note: document.reversedBy.note,
          }
        : null,
      lines,
      blockers,
      receipts,
    };
  }

  /**
   * What each dispatched, not yet received transfer holds in transit at the end of `asOf`, lot by
   * lot (#14, ADR-0028). An in-transit location mixes every transfer from its origin; a transfer's
   * own share is exactly the lots it dispatched until its one receipt posts and clears them all.
   */
  async inTransit(query: InTransitQueryDto): Promise<InTransitView> {
    const today = this.ledger.today();
    const asOf = query.asOf ?? today;
    if (!isIsoDate(asOf)) {
      throw new BusinessRuleError('INVALID_DATE', 'asOf must be a real date written YYYY-MM-DD', {
        field: 'asOf',
      });
    }
    if (compareDates(asOf, today) > 0) {
      throw new BusinessRuleError(
        'AS_OF_IN_FUTURE',
        'Stock in transit is known up to today, not for a date still to come',
      );
    }
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT t."document_id" AS "id"
      FROM "transfers" t
      JOIN "stock_documents" d ON d."id" = t."document_id"
      LEFT JOIN "stock_documents" r ON r."id" = t."receipt_document_id"
      LEFT JOIN "stock_documents" v ON v."reverses_id" = t."document_id"
      WHERE d."status" = 'posted' AND d."business_date" <= ${asOf}::date
        AND (r."id" IS NULL OR r."business_date" > ${asOf}::date)
        AND (v."id" IS NULL OR v."business_date" > ${asOf}::date)
      ORDER BY d."number"
    `;
    if (rows.length === 0) return { asOf, transfers: [] };
    const transfers = await this.prisma.transfer.findMany({
      where: { documentId: { in: rows.map((r) => r.id) } },
      include: { picks: { orderBy: { pickNo: 'asc' } }, document: true },
    });
    const [locations, inTransit, lots] = await Promise.all([
      this.locations.describe(transfers.flatMap((t) => [t.originId, t.destinationId])),
      this.locations.inTransitOf(transfers.map((t) => t.originId)),
      this.ledger.lotFacts(transfers.flatMap((t) => t.picks.map((p) => p.lotId))),
    ]);
    const itemFacts = await this.items.describe([...lots.values()].map((l) => l.itemId));
    return {
      asOf,
      transfers: transfers
        .sort((a, b) => a.document.number.localeCompare(b.document.number))
        .map((t) => ({
          transfer: {
            id: t.documentId,
            number: t.document.number,
            businessDate: t.document.businessDate.toISOString().slice(0, 10),
          },
          origin: locationRef(locations.get(t.originId)!),
          destination: locationRef(locations.get(t.destinationId)!),
          inTransit: locationRef(inTransit.get(t.originId)!),
          lots: t.picks.map((p) => {
            const lot = lots.get(p.lotId)!;
            return {
              item: itemRef(itemFacts.get(lot.itemId)!),
              lot: { id: lot.id, number: lot.number, expiryDate: lot.expiryDate },
              quantity: normaliseDecimal(p.quantity.toFixed()),
              pieces: p.secondaryQuantity?.toFixed() ?? null,
            };
          }),
        })),
    };
  }

  // --- drafting --------------------------------------------------------------------

  async create(
    dto: CreateTransferDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferView> {
    const businessDate = dto.businessDate ?? this.ledger.today();
    const route = await this.route(dto.originId, dto.destinationId);
    labelRequestLocation(route.origin.code);
    const lines = await this.validLines(dto.lines);
    const id = await this.prisma.$transaction(async (tx) => {
      const document = await this.ledger.createDraft(
        tx,
        'transfer',
        { businessDate, note: dto.note ?? null },
        actor,
      );
      labelRequestDocument(document.number);
      await tx.transfer.create({
        data: {
          documentId: document.id,
          originId: route.origin.id,
          destinationId: route.destination.id,
        },
      });
      await tx.transferLine.createMany({
        data: lines.map((l, index) => ({ documentId: document.id, lineNo: index + 1, ...l })),
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'Transfer',
        entityId: document.id,
        summary: `Drafted transfer ${document.number} from ${route.origin.code} to ${route.destination.code}`,
        changes: { status: { from: null, to: 'draft' }, lineCount: lines.length },
        ...meta,
      });
      return document.id;
    });
    return this.get(id);
  }

  async update(
    id: string,
    dto: UpdateTransferDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferView> {
    const existing = await this.existing(id);
    const route =
      dto.originId !== undefined || dto.destinationId !== undefined
        ? await this.route(
            dto.originId ?? existing.originId,
            dto.destinationId ?? existing.destinationId,
          )
        : null;
    const lines = dto.lines ? await this.validLines(dto.lines) : null;
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      assertDraft(doc);
      await this.ledger.updateDraft(tx, doc, {
        ...(dto.businessDate !== undefined ? { businessDate: dto.businessDate } : {}),
        ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
      });
      if (route) {
        await tx.transfer.update({
          where: { documentId: id },
          data: { originId: route.origin.id, destinationId: route.destination.id },
        });
      }
      if (lines) {
        await tx.transferLine.deleteMany({ where: { documentId: id } });
        await tx.transferLine.createMany({
          data: lines.map((l, index) => ({ documentId: id, lineNo: index + 1, ...l })),
        });
      }
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'Transfer',
        entityId: id,
        summary: `Edited draft transfer ${doc.number}`,
        changes: { fields: Object.keys(dto).filter((key) => key !== 'revision') },
        ...meta,
      });
    });
    return this.get(id);
  }

  /** Cancels a draft with a reason. Final: nothing ever left. */
  async cancel(
    id: string,
    dto: CancelTransferDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferView> {
    await this.existing(id);
    if (dto.reason.length === 0) {
      throw new BusinessRuleError(
        'CANCELLATION_REASON_MISSING',
        'Say why the transfer is cancelled, for whoever asked for it',
      );
    }
    let number = '';
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      number = doc.number;
      assertDraft(doc);
      await tx.transfer.update({
        where: { documentId: id },
        data: {
          cancelledById: actor.userId,
          cancelledAt: new Date(),
          cancellationReason: dto.reason,
        },
      });
      await this.ledger.moveTo(tx, doc, 'cancelled');
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'Transfer',
        entityId: id,
        summary: `Cancelled transfer ${doc.number}`,
        changes: { status: { from: 'draft', to: 'cancelled' }, reason: dto.reason },
        ...meta,
      });
    });
    this.logger.write({
      severity: 'INFO',
      event: 'app.log',
      message: `Cancelled ${number}`,
      labels: { document_number: number },
    });
    return this.get(id);
  }

  // --- dispatching -----------------------------------------------------------------

  /**
   * Dispatches a draft with the lots that really left: each line's lots, which FEFO suggests and
   * the person may change, never to a lot expired on the transfer's business date. The ledger moves
   * them from the origin into its in-transit location in one transaction, and refuses, counts and
   * logs by rule anything that would take the origin below zero.
   */
  async dispatch(
    id: string,
    dto: DispatchTransferDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferView> {
    const existing = await this.existing(id);
    const picks = await this.validPicks(existing, dto);
    await this.ledger.post(
      id,
      dto.revision,
      actor,
      (tx, doc) => this.dispatchPlan(tx, doc, picks, actor, meta),
      { from: 'draft', notReady: 'cancelled' },
    );
    return this.get(id);
  }

  /**
   * Run by the ledger inside the posting transaction, with the transfer locked: checks the lots
   * against the transfer as it stands, records them as its lot lines, and hands the ledger the
   * moves from the origin to in-transit.
   */
  private async dispatchPlan(
    tx: Tx,
    doc: LockedDocument,
    picks: DispatchPick[],
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PostingPlan> {
    const row = await tx.transfer.findUniqueOrThrow({
      where: { documentId: doc.id },
      include: TRANSFER_INCLUDE,
    });
    const [locations, inTransitOf, items, facts, held] = await Promise.all([
      this.locations.describe([row.originId, row.destinationId], tx),
      this.locations.inTransitOf([row.originId], tx),
      this.items.describe(row.lines.map((l) => l.itemId)),
      this.ledger.lotFacts(
        picks.map((p) => p.lotId),
        tx,
      ),
      this.ledger.heldAt(
        row.originId,
        picks.map((p) => p.lotId),
        tx,
      ),
    ]);
    const origin = locations.get(row.originId)!;
    const destination = locations.get(row.destinationId)!;
    const inTransit = inTransitOf.get(row.originId)!;
    labelRequestLocation(origin.code);

    // Every lot is of its line's item and held at the origin: anything else is a wrong request,
    // not a posting rule.
    for (const pick of picks) {
      const line = row.lines.find((l) => l.lineNo === pick.lineNo);
      const lot = facts.get(pick.lotId);
      if (!line || !lot || lot.itemId !== line.itemId || !held.has(pick.lotId)) {
        throw pickError(
          pick.lineNo,
          `lot ${lot?.number ?? pick.lotId} is not ${line ? items.get(line.itemId)!.code : 'an item of this transfer'} held at ${origin.code}`,
        );
      }
    }

    const blocker = dispatchBlockers({
      businessDate: doc.businessDate,
      locationsActive: origin.active && destination.active && inTransit.active,
      lines: row.lines.map((l) => ({ lineNo: l.lineNo, item: items.get(l.itemId)! })),
      picks,
      lots: facts,
    })[0];
    if (blocker) {
      return {
        refusal: { rule: blocker.rule, ...('lineNo' in blocker ? { lineNo: blocker.lineNo } : {}) },
      };
    }

    // Lot lines in line order, then the order FEFO takes them, numbered across the transfer.
    const ordered = row.lines.flatMap((line) =>
      fefoOrder(
        picks
          .filter((p) => p.lineNo === line.lineNo)
          .map((p) => ({ ...p, ...lotKey(facts.get(p.lotId)!) })),
      ),
    );
    await tx.transferPick.createMany({
      data: ordered.map((p, index) => ({
        documentId: doc.id,
        pickNo: index + 1,
        lineNo: p.lineNo,
        lotId: p.lotId,
        quantity: p.quantity,
        secondaryQuantity: p.pieces,
      })),
    });
    const lotChanges: LotChange[] = ordered.flatMap((pick, index) => {
      const itemId = facts.get(pick.lotId)!.itemId;
      // A ledger entry carries a piece count, or none; never zero pieces.
      const p = { ...pick, pieces: pick.pieces === '0' ? null : pick.pieces };
      const base = { lineNo: index + 1, lotId: p.lotId, itemId };
      return [
        {
          ...base,
          locationId: origin.id,
          quantity: negated(p.quantity),
          secondaryQuantity: p.pieces === null ? null : negated(p.pieces),
        },
        {
          ...base,
          locationId: inTransit.id,
          quantity: p.quantity,
          secondaryQuantity: p.pieces,
        },
      ];
    });
    await this.audit.recordWithin(tx, {
      actorUserId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'Transfer',
      entityId: doc.id,
      summary: `Dispatched transfer ${doc.number} from ${origin.code} to ${destination.code}: ${ordered.length} lots`,
      changes: {
        status: { from: 'draft', to: 'dispatched' },
        picks: ordered.map((p) => ({ lineNo: p.lineNo, lotId: p.lotId, quantity: p.quantity })),
      },
      ...meta,
    });
    return { lotChanges };
  }

  // --- reversing -------------------------------------------------------------------

  /**
   * Reverses a dispatch while no receipt of the transfer has posted (ADR-0028): the ledger's
   * reversal (#7) negates the dispatch exactly, so every lot goes back from in transit to the
   * origin with its cost and expiry. The transfer is locked as a receipt's posting locks it, so a
   * reversal and a receipt posting at once queue there and only the first wins: the reversal is
   * refused once a receipt has posted, and a receipt of a reversed transfer is refused from then
   * on. A posted receipt is never reversed here; it is corrected by an adjustment.
   */
  async reverse(
    id: string,
    dto: ReverseTransferDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferView> {
    const { number } = await this.existing(id);
    const reversal: DocumentRef = await this.ledger.reverse(
      id,
      { businessDate: dto.businessDate, note: dto.note ?? null },
      actor,
      async (tx) => {
        const transfer = await this.lockForReceipt(tx, id);
        const refusal = dispatchReversalRefusal(transfer.status);
        if (refusal) throw new PostingRefusedError(refusal);
      },
    );
    await this.audit.record({
      actorUserId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'Transfer',
      entityId: id,
      summary: `Reversed the dispatch of transfer ${number} with ${reversal.number}`,
      changes: { status: { from: 'dispatched', to: 'reversed' }, reversal: reversal.number },
      ...meta,
    });
    return this.get(id);
  }

  // --- for transfer receipts ---------------------------------------------------------

  /**
   * Locks a transfer for its receipt's posting, or its dispatch's reversal, then reads it: two
   * receipts of the same transfer, or a receipt and a reversal, queue here, and the second finds
   * it already received or reversed (ADR-0028).
   */
  async lockForReceipt(tx: Tx, transferId: string): Promise<ReceivableTransfer> {
    await tx.$queryRaw`
      SELECT "document_id" FROM "transfers" WHERE "document_id" = ${transferId}::uuid FOR UPDATE
    `;
    return this.receivable(transferId, tx);
  }

  /** What a receipt needs to know about its transfer, as it stands in `tx`. */
  async receivable(transferId: string, tx: Tx = this.prisma): Promise<ReceivableTransfer> {
    const row = await tx.transfer.findUnique({
      where: { documentId: transferId },
      include: {
        picks: { orderBy: { pickNo: 'asc' } },
        document: {
          select: {
            number: true,
            status: true,
            businessDate: true,
            reversedBy: { select: { id: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundError('Transfer', transferId);
    const [locations, inTransit] = await Promise.all([
      this.locations.describe([row.originId, row.destinationId], tx),
      this.locations.inTransitOf([row.originId], tx),
    ]);
    const documentStatus = row.document.status as 'draft' | 'posted' | 'cancelled';
    return {
      id: row.documentId,
      number: row.document.number,
      status: transferStatus(
        documentStatus,
        row.receiptDocumentId !== null,
        row.document.reversedBy !== null,
      ),
      businessDate: row.document.businessDate.toISOString().slice(0, 10),
      origin: locations.get(row.originId)!,
      destination: locations.get(row.destinationId)!,
      inTransit: inTransit.get(row.originId) ?? null,
      receiptDocumentId: row.receiptDocumentId,
      picks: row.picks.map((p) => ({
        pickNo: p.pickNo,
        lineNo: p.lineNo,
        lotId: p.lotId,
        quantity: normaliseDecimal(p.quantity.toFixed()),
        pieces: p.secondaryQuantity?.toFixed() ?? null,
      })),
    };
  }

  /** Records the receipt that took the transfer out of transit, inside its posting. */
  async markReceived(tx: Tx, transferId: string, receiptDocumentId: string): Promise<void> {
    await tx.transfer.update({ where: { documentId: transferId }, data: { receiptDocumentId } });
  }

  // --- internals -------------------------------------------------------------------

  private async existing(id: string): Promise<{
    number: string;
    originId: string;
    destinationId: string;
    lines: Array<{ lineNo: number; itemId: string }>;
  }> {
    const row = await this.prisma.transfer.findUnique({
      where: { documentId: id },
      select: {
        originId: true,
        destinationId: true,
        lines: { select: { lineNo: true, itemId: true } },
        document: { select: { number: true } },
      },
    });
    if (!row) throw new NotFoundError('Transfer', id);
    labelRequestDocument(row.document.number);
    const origin = (await this.locations.describe([row.originId])).get(row.originId);
    if (origin) labelRequestLocation(origin.code);
    return {
      number: row.document.number,
      originId: row.originId,
      destinationId: row.destinationId,
      lines: row.lines,
    };
  }

  private async route(
    originId: string,
    destinationId: string,
  ): Promise<{ origin: LocationFacts; destination: LocationFacts }> {
    const locations = await this.locations.describe([originId, destinationId]);
    const origin = locations.get(originId);
    const destination = locations.get(destinationId);
    if (!origin) throw new NotFoundError('Location', originId);
    if (!destination) throw new NotFoundError('Location', destinationId);
    const problem = routeProblem(origin, destination);
    if (problem) throw new BusinessRuleError('INVALID_ROUTE', ROUTE_ERRORS[problem], { problem });
    return { origin, destination };
  }

  /** Lines checked against their items: each item once, active, in its base unit's decimals. */
  private async validLines(
    lines: readonly TransferLineDto[],
  ): Promise<Array<{ itemId: string; quantity: string }>> {
    const items = await this.items.describe(lines.map((l) => l.itemId));
    const seen = new Set<string>();
    return lines.map((line, index) => {
      const lineNo = index + 1;
      const item = items.get(line.itemId);
      if (!item) throw new NotFoundError('Item', line.itemId);
      if (!item.active) throw lineError(lineNo, `${item.code} is no longer in use`);
      if (seen.has(item.id)) throw lineError(lineNo, `${item.code} is on the transfer twice`);
      seen.add(item.id);
      const problem = positiveQuantityProblem(line.quantity, item.baseUnitDecimals);
      if (problem) {
        throw lineError(
          lineNo,
          `the quantity of ${item.code} ${QUANTITY_ERRORS[problem]} (${item.baseUnitCode}, ${item.baseUnitDecimals} decimals)`,
        );
      }
      return { itemId: item.id, quantity: normaliseDecimal(line.quantity) };
    });
  }

  /** The picks' shape: a line of the transfer, a lot once, a quantity, pieces where they belong. */
  private async validPicks(
    transfer: { lines: Array<{ lineNo: number; itemId: string }> },
    dto: DispatchTransferDto,
  ): Promise<DispatchPick[]> {
    const items = await this.items.describe(transfer.lines.map((l) => l.itemId));
    const seen = new Set<string>();
    return dto.picks.map((pick) => {
      const line = transfer.lines.find((l) => l.lineNo === pick.lineNo);
      if (!line) throw pickError(pick.lineNo, 'is not a line of this transfer');
      const item = items.get(line.itemId)!;
      if (seen.has(pick.lotId)) throw pickError(pick.lineNo, 'a lot is picked twice');
      seen.add(pick.lotId);
      const problem = positiveQuantityProblem(pick.quantity, item.baseUnitDecimals);
      if (problem) {
        throw pickError(pick.lineNo, `the quantity taken ${QUANTITY_ERRORS[problem]}`);
      }
      const pieces = pick.pieces ?? null;
      if (pieces !== null) {
        if (!item.variableWeight) {
          throw pickError(pick.lineNo, 'a piece count is recorded only for variable-weight items');
        }
        if (!piecesValid(pieces, false)) {
          throw pickError(pick.lineNo, 'a piece count is a whole number, not below zero');
        }
      }
      return {
        lineNo: pick.lineNo,
        lotId: pick.lotId,
        quantity: normaliseDecimal(pick.quantity),
        pieces: pieces === null ? null : normaliseDecimal(pieces),
      };
    });
  }

  private async receiptsOf(transferId: string): Promise<ReceiptRef[]> {
    const rows = await this.prisma.transferReceipt.findMany({
      where: { transferId },
      select: { documentId: true },
    });
    const documents = await this.ledger.documents(rows.map((r) => r.documentId));
    return [...documents.values()]
      .map((d) => ({
        id: d.id,
        number: d.number,
        status: d.status as ReceiptRef['status'],
        businessDate: d.businessDate,
        createdBy: d.createdBy,
      }))
      .sort((a, b) => a.number.localeCompare(b.number));
  }

  private async receivedBy(receiptDocumentId: string): Promise<TransferView['received']> {
    const [document, receipt] = await Promise.all([
      this.ledger.document(receiptDocumentId),
      this.prisma.transferReceipt.findUniqueOrThrow({
        where: { documentId: receiptDocumentId },
        select: { submittedBy: PERSON, approvedBy: PERSON },
      }),
    ]);
    return {
      receipt: { id: document.id, number: document.number, businessDate: document.businessDate },
      by: receipt.submittedBy ?? document.createdBy,
      approvedBy: receipt.approvedBy,
      at: document.postedAt!,
    };
  }

  /** Per origin: how many transfers are in transit, and since when the oldest. */
  private async inTransitByOrigin(): Promise<
    Array<{ originCode: string; count: number; oldestAgeSeconds: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ originCode: string; count: bigint; oldest: Date | null }>
    >`
      SELECT o."code" AS "originCode",
             COUNT(d."id") AS "count",
             MIN(d."posted_at") AS "oldest"
      FROM "locations" o
      LEFT JOIN "transfers" t ON t."origin_id" = o."id" AND t."receipt_document_id" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "stock_documents" v WHERE v."reverses_id" = t."document_id")
      LEFT JOIN "stock_documents" d ON d."id" = t."document_id" AND d."status" = 'posted'
      WHERE o."type" IN ('plant', 'warehouse') AND o."active"
      GROUP BY o."code"
      ORDER BY o."code"
    `;
    const now = Date.now();
    return rows.map((row) => ({
      originCode: row.originCode,
      count: Number(row.count),
      oldestAgeSeconds: row.oldest
        ? Math.max(0, Math.round((now - row.oldest.getTime()) / 1000))
        : 0,
    }));
  }
}

/** What a transfer receipt reads about its transfer. */
export interface ReceivableTransfer {
  id: string;
  number: string;
  status: TransferStatus;
  businessDate: string;
  origin: LocationFacts;
  destination: LocationFacts;
  inTransit: LocationFacts | null;
  receiptDocumentId: string | null;
  picks: Array<{
    pickNo: number;
    lineNo: number;
    lotId: string;
    quantity: string;
    pieces: string | null;
  }>;
}

const QUANTITY_ERRORS = {
  NOT_A_NUMBER: 'must be a number',
  NOT_POSITIVE: 'must be more than zero',
  TOO_PRECISE: 'has more decimals than its unit allows',
  TOO_LARGE: 'is too large',
} as const;

/**
 * FEFO's lots for each line's quantity from the origin's stock. A pick that takes all that is left
 * of a lot takes all its pieces too; a part of a lot has its pieces counted, never estimated.
 */
function suggestedPicks(
  row: Pick<TransferRow, 'lines'>,
  available: readonly StockedLot[],
  businessDate: string,
): DispatchPick[] {
  return row.lines.flatMap((line) => {
    const lots = available.filter((lot) => lot.itemId === line.itemId);
    return fefoPick(lots, line.quantity.toFixed(), businessDate).picks.map((pick) => {
      const lot = lots.find((l) => l.lotId === pick.lotId)!;
      const whole = normaliseDecimal(lot.available) === normaliseDecimal(pick.quantity);
      return {
        lineNo: line.lineNo,
        lotId: pick.lotId,
        quantity: pick.quantity,
        pieces: whole ? lot.availablePieces : null,
      };
    });
  });
}

function statusOf(document: StockDocumentView, received: boolean): TransferStatus {
  return transferStatus(
    document.status as 'draft' | 'posted' | 'cancelled',
    received,
    document.reversedBy !== null,
  );
}

function assertDraft(doc: LockedDocument): void {
  if (doc.status !== 'draft') {
    throw new DomainError(
      'STEP_NOT_ALLOWED',
      'Only a draft transfer can be changed or cancelled: this one has already been dispatched or cancelled',
      HttpStatus.CONFLICT,
      { status: doc.status },
    );
  }
}

function lineError(lineNo: number, problem: string): BusinessRuleError {
  return new BusinessRuleError('INVALID_TRANSFER_LINE', `Line ${lineNo}: ${problem}`, { lineNo });
}

function pickError(lineNo: number, problem: string): BusinessRuleError {
  return new BusinessRuleError('INVALID_TRANSFER_PICK', `Line ${lineNo}: ${problem}`, { lineNo });
}

function lotKey(lot: LotFacts): { number: string; expiryDate: string } {
  return { number: lot.number, expiryDate: lot.expiryDate };
}

function pickView(
  pick: DispatchPick & { pickNo: number | null },
  lot: LotFacts,
  outcome: Prisma.TransferReceiptLineGetPayload<{ select: typeof OUTCOME_SELECT }> | undefined,
): TransferPickView {
  return {
    pickNo: pick.pickNo,
    lotId: pick.lotId,
    number: lot.number,
    expiryDate: lot.expiryDate,
    unitCost: lot.unitCost,
    quantity: pick.quantity,
    pieces: pick.pieces,
    outcome: outcome ? outcomeView(outcome, lot.unitCost) : null,
  };
}

function outcomeView(
  line: Prisma.TransferReceiptLineGetPayload<{ select: typeof OUTCOME_SELECT }>,
  unitCost: string,
): PickOutcome {
  const writtenOff = normaliseDecimal(line.writtenOff.toFixed());
  return {
    accepted: normaliseDecimal(line.accepted.toFixed()),
    acceptedPieces: line.acceptedPieces?.toFixed() ?? null,
    returned: normaliseDecimal(line.returned.toFixed()),
    returnedPieces: line.returnedPieces?.toFixed() ?? null,
    writtenOff,
    writtenOffPieces: line.writtenOffPieces?.toFixed() ?? null,
    writtenOffValue: stockValue(writtenOff, unitCost),
    reason: line.reason,
  };
}

function availableView(lot: StockedLot, businessDate: string): AvailableLotView {
  return {
    lotId: lot.lotId,
    number: lot.number,
    expiryDate: lot.expiryDate,
    expired: isExpired(lot.expiryDate, businessDate),
    unitCost: lot.unitCost,
    available: lot.available,
    availablePieces: lot.availablePieces,
  };
}

export function itemRef(item: ItemFacts): ItemRef {
  return {
    id: item.id,
    code: item.code,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    baseUnitCode: item.baseUnitCode,
    variableWeight: item.variableWeight,
  };
}

export function locationRef(location: LocationFacts): LocationRef {
  return {
    id: location.id,
    code: location.code,
    type: location.type,
    nameTh: location.nameTh,
    nameEn: location.nameEn,
  };
}

/** The same quantity, below zero. */
function negated(text: string): string {
  return formatMinimal(negate(decimal(text)));
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value || sign(value) < 0) throw new Error(`not a decimal: "${text}"`);
  return value;
}

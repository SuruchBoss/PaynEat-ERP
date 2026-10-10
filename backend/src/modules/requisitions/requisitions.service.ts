// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import {
  BusinessRuleError,
  ConflictError,
  DomainError,
  NotFoundError,
} from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import { normaliseDecimal } from '../../core/quantity/domain/stock-value';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { SequenceService } from '../../core/sequence/sequence.service';
import { labelRequestDocument, labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { addDays, compareDates, isIsoDate } from '../../core/time/domain/business-date';
import { AuditService } from '../audit/audit.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import { LedgerService } from '../ledger/ledger.service';
import { LocationsService, type LocationFacts } from '../locations/locations.service';
import { TransfersService, type RequisitionTransfer } from '../transfers/transfers.service';
import {
  lineMissed,
  linesProblem,
  NOTHING,
  outstanding,
  quantityProblem,
  requisitionStatus,
  stepAllowed,
  submitProblem,
  suggestedQuantity,
  type FulfilmentLine,
  type LineProblem,
  type QuantityProblem,
  type RequisitionStatus,
  type RequisitionStep,
  type StoredRequisitionStatus,
} from './domain/requisition-rules';
import type {
  CancelRequisitionDto,
  CreateRequisitionDto,
  CreateRequisitionTransferDto,
  ItemRef,
  LocationRef,
  ParLevelDto,
  ParLevelsQueryDto,
  ParLevelView,
  ParMissesQueryDto,
  ParMissesView,
  ParMissRow,
  RequisitionLineDto,
  RequisitionLineView,
  RequisitionsQueryDto,
  RequisitionStepDto,
  RequisitionSummary,
  RequisitionView,
  SuggestionsView,
  UpdateRequisitionDto,
} from './dto/requisitions.dto';

type Tx = Prisma.TransactionClient;
type TransferView = Awaited<ReturnType<TransfersService['create']>>;

/** What the par-miss report covers when the period is left out: four weeks to today. */
const PAR_MISS_DEFAULT_DAYS = 28;

const PERSON = { select: { id: true, displayName: true } } as const;

const REQUISITION_INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  createdBy: PERSON,
  submittedBy: PERSON,
  cancelledBy: PERSON,
} satisfies Prisma.RequisitionInclude;

interface LockedRequisition {
  id: string;
  number: string;
  status: StoredRequisitionStatus;
  revision: number;
  branchId: string;
}

const QUANTITY_ERRORS: Record<QuantityProblem, string> = {
  NOT_A_NUMBER: 'must be a number',
  NOT_POSITIVE: 'must be more than zero',
  TOO_PRECISE: 'has more decimals than its unit allows',
  TOO_LARGE: 'is too large',
};

const STEP_ERRORS: Record<RequisitionStep, string> = {
  edit: 'Only a draft requisition can be edited',
  submit: 'Only a draft requisition can be submitted',
  cancel: 'A requisition can be cancelled only before anything has been dispatched against it',
  fulfil: 'Only a submitted requisition that is not yet fulfilled can be fulfilled',
};

/**
 * Branch requisitions and par levels (#15; ADR-0009, ADR-0029). A branch asks its supplying
 * location (the plant by default) for stock by a date; the screen suggests each item's quantity
 * from the branch's par level, its balance and what is already on the road, and the person edits
 * it. Logistics fulfils a submitted requisition with transfers (#14). A requisition writes no
 * stock, and how far it is fulfilled is read from what its transfers dispatched, never stored.
 *
 * Every step a branch takes goes through `branchFor`, the one place branch scoping is added
 * (#71). Until then anyone holding `requisition:raise` raises for any branch, as #14 lets anyone
 * holding `transfer:receive` receive at any branch.
 */
@Injectable()
export class RequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly ledger: LedgerService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
    private readonly transfers: TransfersService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
  ) {}

  // --- reading ---------------------------------------------------------------------

  async list(query: RequisitionsQueryDto): Promise<RequisitionSummary[]> {
    const stored: StoredRequisitionStatus | undefined =
      query.status === 'draft' || query.status === 'cancelled'
        ? query.status
        : query.status === 'all'
          ? undefined
          : 'submitted';
    const rows = await this.prisma.requisition.findMany({
      where: {
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(stored ? { status: stored } : {}),
      },
      include: REQUISITION_INCLUDE,
    });
    const [transfers, locations] = await Promise.all([
      this.transfers.ofRequisitions(rows.map((r) => r.id)),
      this.locations.describe(rows.flatMap((r) => [r.branchId, r.supplyingLocationId])),
    ]);
    const summaries = rows
      .map((row) => {
        const status = requisitionStatus(row.status, fulfilment(row, transfers));
        return {
          id: row.id,
          number: row.number,
          status,
          revision: row.revision,
          branch: locationRef(locations.get(row.branchId)!),
          supplyingLocation: locationRef(locations.get(row.supplyingLocationId)!),
          neededBy: isoDate(row.neededBy),
          lineCount: row.lines.length,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
          submittedAt: row.submittedAt,
        };
      })
      .filter((r) => matches(r.status, query.status));
    // Logistics' queue is worked by date needed; everything else newest first.
    return query.status === 'open'
      ? summaries.sort(
          (a, b) => compareDates(a.neededBy, b.neededBy) || a.number.localeCompare(b.number),
        )
      : summaries.sort((a, b) => b.number.localeCompare(a.number));
  }

  async get(id: string): Promise<RequisitionView> {
    const row = await this.prisma.requisition.findUnique({
      where: { id },
      include: REQUISITION_INCLUDE,
    });
    if (!row) throw new NotFoundError('Requisition', id);
    labelRequestDocument(row.number);
    const [transfers, locations, items] = await Promise.all([
      this.transfers.ofRequisitions([row.id]),
      this.locations.describe([row.branchId, row.supplyingLocationId]),
      this.items.describe(row.lines.map((l) => l.itemId)),
    ]);
    const branch = locations.get(row.branchId)!;
    labelRequestLocation(branch.code);
    const lines = fulfilment(row, transfers);
    return {
      id: row.id,
      number: row.number,
      status: requisitionStatus(row.status, lines),
      revision: row.revision,
      branch: locationRef(branch),
      supplyingLocation: locationRef(locations.get(row.supplyingLocationId)!),
      neededBy: isoDate(row.neededBy),
      note: row.note,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      submittedAt: row.submittedAt,
      lines: row.lines.map((line, index): RequisitionLineView => ({
        lineNo: line.lineNo,
        item: itemRef(items.get(line.itemId)!),
        suggested: line.suggested === null ? null : normaliseDecimal(line.suggested.toFixed()),
        requested: lines[index].requested,
        dispatched: lines[index].dispatched,
        drafted: lines[index].drafted,
        outstanding: outstanding(lines[index]),
      })),
      transfers: transfers.map((t) => ({
        id: t.id,
        number: t.number,
        status: t.status,
        businessDate: t.businessDate,
      })),
      submitted:
        row.submittedBy && row.submittedAt ? { by: row.submittedBy, at: row.submittedAt } : null,
      cancelled:
        row.cancelledBy && row.cancelledAt
          ? { by: row.cancelledBy, at: row.cancelledAt, reason: row.cancellationReason! }
          : null,
    };
  }

  /**
   * What the requisition screen suggests for a branch now (ADR-0009 decision 2): every active
   * item with a par level there, with its balance, what is on the road to the branch and the
   * suggestion. Items without a par level are not listed but can still be requested.
   */
  async suggestions(branchId: string): Promise<SuggestionsView> {
    const branch = await this.branch(branchId);
    labelRequestLocation(branch.code);
    const pars = await this.prisma.parLevel.findMany({
      where: { locationId: branch.id, item: { active: true } },
      select: { itemId: true },
    });
    const [items, suggestions] = await Promise.all([
      this.items.describe(pars.map((p) => p.itemId)),
      this.suggestionsFor(
        branch.id,
        pars.map((p) => p.itemId),
      ),
    ]);
    return {
      branch: locationRef(branch),
      items: pars
        .map((p) => ({ item: itemRef(items.get(p.itemId)!), ...suggestions.get(p.itemId)! }))
        .sort((a, b) => a.item.code.localeCompare(b.item.code)),
    };
  }

  // --- the branch's steps ----------------------------------------------------------

  async create(
    dto: CreateRequisitionDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<RequisitionView> {
    const branch = await this.branchFor(actor, dto.branchId);
    labelRequestLocation(branch.code);
    const supplier = await this.supplyingLocation(dto.supplyingLocationId);
    this.assertNeededBy(dto.neededBy);
    const lines = await this.validLines(dto.lines, branch.id);
    const id = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.next(tx, 'REQUISITION', this.currentYear());
      labelRequestDocument(number);
      const created = await tx.requisition.create({
        data: {
          number,
          branchId: branch.id,
          supplyingLocationId: supplier.id,
          neededBy: dateValue(dto.neededBy),
          note: dto.note ?? null,
          createdById: actor.userId,
        },
      });
      await writeLines(tx, created.id, lines);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'Requisition',
        entityId: created.id,
        summary: `Drafted requisition ${number} for ${branch.code} from ${supplier.code}`,
        changes: { status: { from: null, to: 'draft' }, lineCount: lines.length },
        ...meta,
      });
      return created.id;
    });
    return this.get(id);
  }

  /** Changes a draft. Lines, when given, replace them all, with their suggestions as of now. */
  async update(
    id: string,
    dto: UpdateRequisitionDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<RequisitionView> {
    const existing = await this.existing(id);
    await this.branchFor(actor, existing.branchId);
    if (dto.neededBy !== undefined) this.assertNeededBy(dto.neededBy);
    const lines = dto.lines ? await this.validLines(dto.lines, existing.branchId) : null;
    await this.prisma.$transaction(async (tx) => {
      const requisition = await this.lockAt(tx, id, dto.revision);
      assertStep(requisition.status, 'edit');
      await tx.requisition.update({
        where: { id },
        data: {
          ...(dto.neededBy !== undefined ? { neededBy: dateValue(dto.neededBy) } : {}),
          ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
          revision: { increment: 1 },
        },
      });
      if (lines) {
        await tx.requisitionLine.deleteMany({ where: { requisitionId: id } });
        await writeLines(tx, id, lines);
      }
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'Requisition',
        entityId: id,
        summary: `Edited draft requisition ${requisition.number}`,
        changes: {
          fields: Object.keys(dto).filter((key) => key !== 'revision'),
          ...(lines ? { lineCount: lines.length } : {}),
        },
        ...meta,
      });
    });
    return this.get(id);
  }

  /** Submits a draft, checked again as it stands: lines of items still in use, needed today or later. */
  async submit(
    id: string,
    dto: RequisitionStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<RequisitionView> {
    const existing = await this.existing(id);
    await this.branchFor(actor, existing.branchId);
    await this.prisma.$transaction(async (tx) => {
      const requisition = await this.lockAt(tx, id, dto.revision);
      assertStep(requisition.status, 'submit');
      const row = await tx.requisition.findUniqueOrThrow({
        where: { id },
        select: { neededBy: true, lines: { select: { itemId: true, requested: true } } },
      });
      const problem = submitProblem({
        lineCount: row.lines.length,
        neededBy: isoDate(row.neededBy),
        today: this.ledger.today(),
      });
      if (problem === 'EMPTY_REQUISITION') {
        throw new BusinessRuleError(problem, 'A requisition asks for at least one item');
      }
      if (problem === 'NEEDED_BY_PASSED') {
        throw new BusinessRuleError(
          problem,
          'The needed-by date has passed: change it to today or later before submitting',
          { neededBy: isoDate(row.neededBy), today: this.ledger.today() },
        );
      }
      const items = await this.items.describe(
        row.lines.map((l) => l.itemId),
        tx,
      );
      const lineProblem = linesProblem(
        row.lines.map((l) => ({
          itemId: l.itemId,
          requested: normaliseDecimal(l.requested.toFixed()),
        })),
        lineFacts(items),
      );
      if (lineProblem) throw lineError(lineProblem, items);
      await tx.requisition.update({
        where: { id },
        data: {
          status: 'submitted',
          submittedById: actor.userId,
          submittedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'Requisition',
        entityId: id,
        summary: `Submitted requisition ${requisition.number}`,
        changes: { status: { from: 'draft', to: 'submitted' }, lineCount: row.lines.length },
        ...meta,
      });
    });
    return this.get(id);
  }

  /**
   * Cancels a requisition before anything was dispatched against it, with a reason. Final. A draft
   * transfer of it is cancelled first, by logistics, so nobody dispatches against a requisition
   * nobody wants any more. The requisition's row is locked as a transfer from it is created, so the
   * two queue and the second sees the first.
   */
  async cancel(
    id: string,
    dto: CancelRequisitionDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<RequisitionView> {
    const existing = await this.existing(id);
    await this.branchFor(actor, existing.branchId);
    if (dto.reason.length === 0) {
      throw new BusinessRuleError(
        'CANCELLATION_REASON_MISSING',
        'Say why the requisition is cancelled, for logistics',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const requisition = await this.lockAt(tx, id, dto.revision);
      const transfers = await this.transfers.ofRequisitions([id], tx);
      const lines = await this.fulfilmentIn(tx, id, transfers);
      const status = requisitionStatus(requisition.status, lines);
      assertStep(status, 'cancel');
      const draft = transfers.find((t) => t.status === 'draft');
      if (draft) {
        throw new BusinessRuleError(
          'REQUISITION_HAS_DRAFT_TRANSFER',
          `Transfer ${draft.number} is being prepared for this requisition: logistics cancels it first`,
          { transfer: draft.number },
        );
      }
      await tx.requisition.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledById: actor.userId,
          cancelledAt: new Date(),
          cancellationReason: dto.reason,
          revision: { increment: 1 },
        },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'Requisition',
        entityId: id,
        summary: `Cancelled requisition ${requisition.number}`,
        changes: { status: { from: status, to: 'cancelled' }, reason: dto.reason },
        ...meta,
      });
    });
    this.logger.write({
      severity: 'INFO',
      event: 'app.log',
      message: `Cancelled ${existing.number}`,
      labels: { document_number: existing.number },
    });
    return this.get(id);
  }

  // --- logistics -------------------------------------------------------------------

  /**
   * Drafts a transfer from a submitted requisition (#14), from its supplying location to its
   * branch, with the outstanding quantities unless the lines say otherwise; only items the
   * requisition asks for. The requisition is locked inside the transfer's transaction and checked
   * again there, and its revision moves on, so two people preparing transfers from it at once do
   * not both send what was outstanding: the second is asked to reload.
   */
  async createTransfer(
    id: string,
    dto: CreateRequisitionTransferDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferView> {
    const existing = await this.existing(id);
    const row = await this.prisma.requisition.findUniqueOrThrow({
      where: { id },
      include: REQUISITION_INCLUDE,
    });
    const lines = fulfilment(row, await this.transfers.ofRequisitions([id]));
    assertStep(requisitionStatus(row.status, lines), 'fulfil');
    const asked = new Set(row.lines.map((l) => l.itemId));
    const transferLines = dto.lines
      ? dto.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity }))
      : row.lines
          .map((line, index) => ({ itemId: line.itemId, quantity: outstanding(lines[index]) }))
          .filter((l) => l.quantity !== NOTHING);
    if (transferLines.length === 0) {
      throw new BusinessRuleError(
        'NOTHING_OUTSTANDING',
        'Everything this requisition asks for is dispatched or already in a draft transfer',
      );
    }
    const stranger = transferLines.find((l) => !asked.has(l.itemId));
    if (stranger) {
      throw new BusinessRuleError(
        'ITEM_NOT_REQUESTED',
        'A transfer from a requisition sends only items the requisition asks for',
        { itemId: stranger.itemId },
      );
    }
    return this.transfers.create(
      {
        originId: row.supplyingLocationId,
        destinationId: row.branchId,
        businessDate: dto.businessDate,
        note: dto.note ?? null,
        lines: transferLines,
      },
      actor,
      meta,
      {
        requisitionId: id,
        guard: async (tx) => {
          const requisition = await this.lockAt(tx, id, dto.revision);
          const current = await this.fulfilmentIn(
            tx,
            id,
            await this.transfers.ofRequisitions([id], tx),
          );
          assertStep(requisitionStatus(requisition.status, current), 'fulfil');
          await tx.requisition.update({ where: { id }, data: { revision: { increment: 1 } } });
          labelRequestDocument(existing.number);
        },
      },
    );
  }

  // --- par misses ------------------------------------------------------------------

  /**
   * Par misses per branch and item over a period of business dates (ADR-0009, ADR-0029): how many
   * times the item's balance at the branch went below zero, and how many requisition lines due in
   * the period were not fully dispatched by their needed-by date. Pairs with a par level are
   * listed even with no miss, so a par level that works shows as one.
   */
  async parMisses(query: ParMissesQueryDto): Promise<ParMissesView> {
    const today = this.ledger.today();
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, 1 - PAR_MISS_DEFAULT_DAYS);
    for (const [field, value] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (!isIsoDate(value)) {
        throw new BusinessRuleError('INVALID_DATE', `${field} must be a real date`, { field });
      }
    }
    if (compareDates(to, today) > 0) {
      throw new BusinessRuleError(
        'PERIOD_IN_FUTURE',
        'Par misses are known up to today, not for dates still to come',
      );
    }
    if (compareDates(from, to) > 0) {
      throw new BusinessRuleError('INVALID_PERIOD', 'The period starts on or before it ends');
    }
    const branchIds = query.branchId
      ? [(await this.branch(query.branchId)).id]
      : (await this.locations.list({ type: 'branch', status: 'all' })).map((b) => b.id);

    const [episodes, pars, due] = await Promise.all([
      this.ledger.negativeEpisodes({ from, to, locationIds: branchIds }),
      this.prisma.parLevel.findMany({ where: { locationId: { in: branchIds } } }),
      this.prisma.requisition.findMany({
        where: {
          branchId: { in: branchIds },
          status: 'submitted',
          neededBy: { gte: dateValue(from), lte: dateValue(to), lt: dateValue(today) },
        },
        include: { lines: true },
      }),
    ]);
    const transfers = await this.transfers.ofRequisitions(due.map((r) => r.id));

    const rows = new Map<string, Omit<ParMissRow, 'branch' | 'item'>>();
    const row = (locationId: string, itemId: string) => {
      const key = `${locationId}:${itemId}`;
      if (!rows.has(key)) {
        rows.set(key, { par: null, negativeEpisodes: 0, linesDue: 0, linesMissed: 0 });
      }
      return rows.get(key)!;
    };
    for (const par of pars) {
      row(par.locationId, par.itemId).par = normaliseDecimal(par.quantity.toFixed());
    }
    for (const [key, count] of episodes) {
      const [locationId, itemId] = key.split(':');
      row(locationId, itemId).negativeEpisodes = count;
    }
    for (const requisition of due) {
      const neededBy = isoDate(requisition.neededBy);
      const own = transfers.filter((t) => t.requisitionId === requisition.id);
      const lines = fulfilment(requisition, own);
      const status = requisitionStatus(requisition.status, lines);
      for (const line of requisition.lines) {
        const byThen = sum(
          own
            .filter((t) => compareDates(t.businessDate, neededBy) <= 0)
            .map((t) => t.items.get(line.itemId)?.dispatched ?? '0'),
        );
        const entry = row(requisition.branchId, line.itemId);
        entry.linesDue += 1;
        if (
          lineMissed({
            status,
            neededBy,
            today,
            requested: normaliseDecimal(line.requested.toFixed()),
            dispatchedByNeededBy: byThen,
          })
        ) {
          entry.linesMissed += 1;
        }
      }
    }

    const keys = [...rows.keys()].map((k) => k.split(':') as [string, string]);
    const [locations, items] = await Promise.all([
      this.locations.describe(keys.map(([l]) => l)),
      this.items.describe(keys.map(([, i]) => i)),
    ]);
    return {
      from,
      to,
      rows: keys
        .map(([locationId, itemId]) => ({
          branch: locationRef(locations.get(locationId)!),
          item: itemRef(items.get(itemId)!),
          ...rows.get(`${locationId}:${itemId}`)!,
        }))
        .sort(
          (a, b) =>
            b.negativeEpisodes + b.linesMissed - (a.negativeEpisodes + a.linesMissed) ||
            a.branch.code.localeCompare(b.branch.code) ||
            a.item.code.localeCompare(b.item.code),
        ),
    };
  }

  // --- par levels --------------------------------------------------------------------

  async parLevels(query: ParLevelsQueryDto): Promise<ParLevelView[]> {
    const rows = await this.prisma.parLevel.findMany({
      where: query.locationId ? { locationId: query.locationId } : {},
      include: { updatedBy: PERSON },
    });
    const [locations, items] = await Promise.all([
      this.locations.describe(rows.map((r) => r.locationId)),
      this.items.describe(rows.map((r) => r.itemId)),
    ]);
    return rows
      .map((r) => ({
        location: locationRef(locations.get(r.locationId)!),
        item: itemRef(items.get(r.itemId)!),
        quantity: normaliseDecimal(r.quantity.toFixed()),
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt,
      }))
      .sort(
        (a, b) =>
          a.location.code.localeCompare(b.location.code) || a.item.code.localeCompare(b.item.code),
      );
  }

  /**
   * Sets how much of an item a branch should hold (ADR-0009 decision 2): configuration the admin
   * keeps, audited. A request that changes nothing records nothing.
   */
  async setParLevel(
    locationId: string,
    itemId: string,
    dto: ParLevelDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ParLevelView> {
    const branch = await this.branch(locationId);
    labelRequestLocation(branch.code);
    const item = (await this.items.describe([itemId])).get(itemId);
    if (!item) throw new NotFoundError('Item', itemId);
    if (!item.active) {
      throw new BusinessRuleError('ITEM_INACTIVE', `${item.code} is no longer in use`);
    }
    const problem = quantityProblem(dto.quantity, item.baseUnitDecimals);
    if (problem) {
      throw new BusinessRuleError(
        'INVALID_PAR_LEVEL',
        `The par level of ${item.code} ${problem === 'NOT_POSITIVE' ? 'is zero or more' : QUANTITY_ERRORS[problem]} (${item.baseUnitCode}, ${item.baseUnitDecimals} decimals)`,
        { problem },
      );
    }
    const quantity = normaliseDecimal(dto.quantity);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.parLevel.findUnique({
        where: { locationId_itemId: { locationId, itemId } },
      });
      const was = before ? normaliseDecimal(before.quantity.toFixed()) : null;
      if (was === quantity) return;
      await tx.parLevel.upsert({
        where: { locationId_itemId: { locationId, itemId } },
        create: { locationId, itemId, quantity, updatedById: actor.userId },
        update: { quantity, updatedById: actor.userId },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: before ? AuditAction.UPDATE : AuditAction.CREATE,
        entityType: 'ParLevel',
        entityId: `${locationId}:${itemId}`,
        summary: `Set the par level of ${item.code} at ${branch.code} to ${quantity} ${item.baseUnitCode}`,
        changes: { quantity: { from: was, to: quantity } },
        ...meta,
      });
    });
    return (await this.parLevels({ locationId })).find((p) => p.item.id === itemId)!;
  }

  /** Removes a par level: the item gets no suggestion at the branch any more. Audited. */
  async removeParLevel(
    locationId: string,
    itemId: string,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<void> {
    const before = await this.prisma.parLevel.findUnique({
      where: { locationId_itemId: { locationId, itemId } },
    });
    if (!before) throw new NotFoundError('Par level');
    const [locations, items] = await Promise.all([
      this.locations.describe([locationId]),
      this.items.describe([itemId]),
    ]);
    const branch = locations.get(locationId)!;
    const item = items.get(itemId)!;
    labelRequestLocation(branch.code);
    await this.prisma.$transaction(async (tx) => {
      await tx.parLevel.delete({ where: { locationId_itemId: { locationId, itemId } } });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'ParLevel',
        entityId: `${locationId}:${itemId}`,
        summary: `Removed the par level of ${item.code} at ${branch.code}`,
        changes: { quantity: { from: normaliseDecimal(before.quantity.toFixed()), to: null } },
        ...meta,
      });
    });
  }

  // --- internals -------------------------------------------------------------------

  /**
   * The branch a person acts for on a requisition, checked. The one place branch scoping is added
   * (#71): today any holder of `requisition:raise` may act for any branch.
   */
  private async branchFor(_actor: AuthenticatedUser, branchId: string): Promise<LocationFacts> {
    const branch = await this.branch(branchId);
    if (!branch.active) {
      throw new BusinessRuleError('LOCATION_INACTIVE', 'This branch is no longer in use');
    }
    return branch;
  }

  private async branch(id: string): Promise<LocationFacts> {
    const location = (await this.locations.describe([id])).get(id);
    if (!location) throw new NotFoundError('Location', id);
    if (location.type !== 'branch') {
      throw new BusinessRuleError('NOT_A_BRANCH', `${location.code} is not a branch`);
    }
    return location;
  }

  /** The location asked, or the company's one active plant when none is named. */
  private async supplyingLocation(id: string | undefined): Promise<LocationFacts> {
    if (id === undefined) {
      const plants = await this.locations.list({ type: 'plant', status: 'active' });
      if (plants.length !== 1) {
        throw new BusinessRuleError(
          'SUPPLYING_LOCATION_REQUIRED',
          'Say which plant or warehouse supplies this requisition',
          { plants: plants.length },
        );
      }
      id = plants[0].id;
    }
    const location = (await this.locations.describe([id])).get(id);
    if (!location) throw new NotFoundError('Location', id);
    if (location.type !== 'plant' && location.type !== 'warehouse') {
      throw new BusinessRuleError(
        'NOT_A_SUPPLYING_LOCATION',
        'A requisition is supplied by a plant or a warehouse',
      );
    }
    if (!location.active) {
      throw new BusinessRuleError('LOCATION_INACTIVE', 'This location is no longer in use');
    }
    return location;
  }

  private assertNeededBy(date: string): void {
    if (!isIsoDate(date)) {
      throw new BusinessRuleError('INVALID_DATE', 'neededBy must be a real date', {
        field: 'neededBy',
      });
    }
    if (compareDates(date, this.ledger.today()) < 0) {
      throw new BusinessRuleError('NEEDED_BY_PASSED', 'The needed-by date is today or later', {
        neededBy: date,
        today: this.ledger.today(),
      });
    }
  }

  /** Lines checked against their items, each with what the screen suggests for it now. */
  private async validLines(
    lines: readonly RequisitionLineDto[],
    branchId: string,
  ): Promise<Array<{ itemId: string; requested: string; suggested: string | null }>> {
    const items = await this.items.describe(lines.map((l) => l.itemId));
    const problem = linesProblem(lines, lineFacts(items));
    if (problem) throw lineError(problem, items);
    const suggestions = await this.suggestionsFor(
      branchId,
      lines.map((l) => l.itemId),
    );
    return lines.map((l) => ({
      itemId: l.itemId,
      requested: normaliseDecimal(l.requested),
      suggested: suggestions.get(l.itemId)!.suggested,
    }));
  }

  /** Per item: its par level at the branch, balance, what is on the road, and the suggestion. */
  private async suggestionsFor(
    branchId: string,
    itemIds: readonly string[],
  ): Promise<
    Map<
      string,
      { par: string | null; balance: string; inTransit: string; suggested: string | null }
    >
  > {
    const [pars, balances, inTransit, items] = await Promise.all([
      this.prisma.parLevel.findMany({
        where: { locationId: branchId, itemId: { in: [...itemIds] } },
      }),
      this.ledger.itemBalancesAt(branchId, itemIds),
      this.transfers.inTransitTo(branchId, itemIds),
      this.items.describe(itemIds),
    ]);
    const parOf = new Map(pars.map((p) => [p.itemId, normaliseDecimal(p.quantity.toFixed())]));
    return new Map(
      itemIds.map((itemId) => {
        const par = parOf.get(itemId) ?? null;
        const balance = balances.get(itemId) ?? '0';
        const onTheRoad = inTransit.get(itemId) ?? '0';
        return [
          itemId,
          {
            par,
            balance,
            inTransit: onTheRoad,
            suggested: suggestedQuantity({
              par,
              balance,
              inTransit: onTheRoad,
              requisitionUnit: items.get(itemId)?.requisitionUnit ?? null,
            }),
          },
        ];
      }),
    );
  }

  /** The requisition's lines against its transfers, read inside `tx`. */
  private async fulfilmentIn(
    tx: Tx,
    id: string,
    transfers: RequisitionTransfer[],
  ): Promise<FulfilmentLine[]> {
    const row = await tx.requisition.findUniqueOrThrow({
      where: { id },
      select: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    return fulfilment(row, transfers);
  }

  private currentYear(): number {
    return Number(this.ledger.today().slice(0, 4));
  }

  /** The requisition, locked, at the revision the person acted on; labels the request with its number. */
  private async lockAt(tx: Tx, id: string, revision: number): Promise<LockedRequisition> {
    const rows = await tx.$queryRaw<LockedRequisition[]>`
      SELECT "id", "number", "status"::text AS "status", "revision", "branch_id" AS "branchId"
        FROM "requisitions" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const requisition = rows[0];
    if (!requisition) throw new NotFoundError('Requisition', id);
    labelRequestDocument(requisition.number);
    if (requisition.revision !== revision) {
      throw new ConflictError(
        'REQUISITION_CHANGED',
        'This requisition was changed by someone else since you opened it. Reload it and try again.',
        { currentRevision: requisition.revision },
      );
    }
    return requisition;
  }

  /** Refuses an unknown requisition early, and labels the request with its number and branch. */
  private async existing(id: string): Promise<{ number: string; branchId: string }> {
    const found = await this.prisma.requisition.findUnique({
      where: { id },
      select: { number: true, branchId: true },
    });
    if (!found) throw new NotFoundError('Requisition', id);
    labelRequestDocument(found.number);
    const branch = (await this.locations.describe([found.branchId])).get(found.branchId);
    if (branch) labelRequestLocation(branch.code);
    return found;
  }
}

/** Each line of a requisition against what its transfers planned and dispatched, in line order. */
function fulfilment(
  row: { id?: string; lines: Array<{ itemId: string; requested: Prisma.Decimal }> },
  transfers: readonly RequisitionTransfer[],
): FulfilmentLine[] {
  const own = row.id ? transfers.filter((t) => t.requisitionId === row.id) : transfers;
  return row.lines.map((line) => ({
    requested: normaliseDecimal(line.requested.toFixed()),
    dispatched: sum(own.map((t) => t.items.get(line.itemId)?.dispatched ?? '0')),
    drafted: sum(own.map((t) => t.items.get(line.itemId)?.planned ?? '0')),
  }));
}

function sum(quantities: readonly string[]): string {
  return normaliseDecimal(
    quantities.reduce((total, q) => new Prisma.Decimal(total).add(q).toFixed(), '0'),
  );
}

function matches(status: RequisitionStatus, filter: RequisitionsQueryDto['status']): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return status === 'submitted' || status === 'partially_fulfilled';
  return status === filter;
}

function assertStep(status: RequisitionStatus, step: RequisitionStep): void {
  if (!stepAllowed(status, step)) {
    throw new DomainError('STEP_NOT_ALLOWED', STEP_ERRORS[step], HttpStatus.CONFLICT, { status });
  }
}

function lineFacts(
  items: Map<string, ItemFacts>,
): Map<string, { decimals: number; active: boolean; requisitionUnit: string | null }> {
  return new Map(
    [...items.values()].map((item) => [
      item.id,
      {
        decimals: item.baseUnitDecimals,
        active: item.active,
        requisitionUnit: item.requisitionUnit,
      },
    ]),
  );
}

function lineError(problem: LineProblem, items: Map<string, ItemFacts>): DomainError {
  const item = items.get(problem.itemId);
  const code = item?.code ?? problem.itemId;
  switch (problem.code) {
    case 'DUPLICATE_ITEM':
      return new BusinessRuleError('INVALID_REQUISITION_LINE', `${code} is asked for twice`, {
        problem: problem.code,
        itemId: problem.itemId,
      });
    case 'INACTIVE_ITEM':
      return item
        ? new BusinessRuleError('INVALID_REQUISITION_LINE', `${code} is no longer in use`, {
            problem: problem.code,
            itemId: problem.itemId,
          })
        : new NotFoundError('Item', problem.itemId);
    case 'QUANTITY':
      return new BusinessRuleError(
        'INVALID_REQUISITION_LINE',
        `The quantity of ${code} ${QUANTITY_ERRORS[problem.problem]} (${item!.baseUnitCode}, ${item!.baseUnitDecimals} decimals)`,
        { problem: problem.problem, itemId: problem.itemId },
      );
    case 'NOT_A_MULTIPLE':
      return new BusinessRuleError(
        'INVALID_REQUISITION_LINE',
        `${code} is sent in units of ${problem.requisitionUnit} ${item!.baseUnitCode}: ask for a whole number of them`,
        { problem: problem.code, itemId: problem.itemId, requisitionUnit: problem.requisitionUnit },
      );
  }
}

async function writeLines(
  tx: Tx,
  requisitionId: string,
  lines: Array<{ itemId: string; requested: string; suggested: string | null }>,
): Promise<void> {
  if (lines.length === 0) return;
  await tx.requisitionLine.createMany({
    data: lines.map((line, index) => ({
      requisitionId,
      lineNo: index + 1,
      itemId: line.itemId,
      requested: line.requested,
      suggested: line.suggested,
    })),
  });
}

function itemRef(item: ItemFacts): ItemRef {
  return {
    id: item.id,
    code: item.code,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    baseUnitCode: item.baseUnitCode,
    variableWeight: item.variableWeight,
    requisitionUnit: item.requisitionUnit,
  };
}

function locationRef(location: LocationFacts): LocationRef {
  return {
    id: location.id,
    code: location.code,
    type: location.type,
    nameTh: location.nameTh,
    nameEn: location.nameEn,
  };
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateValue(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

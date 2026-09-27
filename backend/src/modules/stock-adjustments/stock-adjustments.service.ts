// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BusinessRuleError, DomainError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import { formatQuantity, stockValue, sumValues } from '../../core/quantity/domain/stock-value';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { AuditAction, AuditService } from '../audit/audit.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import {
  LedgerService,
  PostingRefusedError,
  type LockedDocument,
  type LotFacts,
  type PostingPlan,
} from '../ledger/ledger.service';
import { LocationsService, type LocationFacts } from '../locations/locations.service';
import {
  lineProblem,
  locationProblem,
  postingRefusal,
  segregationProblem,
  stepAllowed,
  type AdjustmentStatus,
  type Refusal,
  type Step,
} from './domain/adjustment-rules';
import type {
  ApprovedStockAdjustmentView,
  CreateStockAdjustmentDto,
  LocationRef,
  RejectStockAdjustmentDto,
  StockAdjustmentLineDto,
  StockAdjustmentLineView,
  StockAdjustmentsQueryDto,
  StockAdjustmentStepDto,
  StockAdjustmentSummary,
  StockAdjustmentView,
  UpdateStockAdjustmentDto,
} from './dto/stock-adjustments.dto';

type Tx = Prisma.TransactionClient;

interface StoredLine {
  lineNo: number;
  lotId: string;
  itemId: string;
  quantity: string;
  secondaryQuantity: string | null;
  reason: string;
}

const LOCATION_ERRORS = {
  LOCATION_SYSTEM_MANAGED: 'Stock is adjusted at a plant, warehouse or branch, never in transit',
  LOCATION_INACTIVE: 'This location is no longer in use',
} as const;

const STEP_ERRORS: Record<Step, string> = {
  edit: 'Only a draft can be edited: this adjustment has already been submitted',
  submit: 'Only a draft can be submitted',
  approve: 'Only a submitted adjustment can be approved',
  reject: 'Only a submitted adjustment, or an approved one not yet posted, can be rejected',
  post: 'Only an approved adjustment can be posted',
};

const PERSON = { select: { id: true, displayName: true } } as const;

/**
 * Stock adjustments (#8; docs/GLOSSARY.md "Adjustment", "Write-off"): an increase or a decrease
 * on lots that already exist at one location, each line with its reason. A plant or branch user
 * drafts and submits it; someone else approves it (ADR-0008), which posts it through the ledger
 * at the lots' own cost. The ledger refuses a plant, warehouse or in-transit lot going below
 * zero, and lets a branch lot go negative with a flag asking for a count (ADR-0003).
 */
@Injectable()
export class StockAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
  ) {}

  async list(query: StockAdjustmentsQueryDto): Promise<StockAdjustmentSummary[]> {
    const rows = await this.prisma.stockAdjustment.findMany({
      where: query.locationId ? { locationId: query.locationId } : {},
      include: { lines: { select: { lotId: true, quantity: true } } },
    });
    const [documents, locations, lots] = await Promise.all([
      this.ledger.documents(rows.map((r) => r.documentId)),
      this.locations.describe(rows.map((r) => r.locationId)),
      this.ledger.lotFacts(rows.flatMap((r) => r.lines.map((l) => l.lotId))),
    ]);
    return rows
      .map((row) => ({
        ...documents.get(row.documentId)!,
        location: locationRef(locations.get(row.locationId)!),
        lineCount: row.lines.length,
        totalValue: sumValues(
          row.lines.map((l) => stockValue(l.quantity.toFixed(), lots.get(l.lotId)!.unitCost)),
        ),
      }))
      .filter((summary) => query.status === 'all' || summary.status === query.status)
      .sort((a, b) => b.number.localeCompare(a.number));
  }

  async get(id: string): Promise<StockAdjustmentView> {
    const row = await this.prisma.stockAdjustment.findUnique({
      where: { documentId: id },
      include: {
        lines: { orderBy: { lineNo: 'asc' } },
        submittedBy: PERSON,
        approvedBy: PERSON,
        rejectedBy: PERSON,
      },
    });
    if (!row) throw new NotFoundError('Stock adjustment', id);
    const lines = row.lines.map(storedLine);
    const [document, lots, items, locations] = await Promise.all([
      this.ledger.document(id),
      this.ledger.lotFacts(lines.map((l) => l.lotId)),
      this.items.describe(lines.map((l) => l.itemId)),
      this.locations.describe([row.locationId]),
    ]);
    const location = locations.get(row.locationId)!;
    labelRequestLocation(location.code);
    const views = lines.map((line) =>
      lineView(line, items.get(line.itemId)!, lots.get(line.lotId)!),
    );
    return {
      ...document,
      location: locationRef(location),
      submitted: row.submittedBy ? { by: row.submittedBy, at: row.submittedAt! } : null,
      approved: row.approvedBy ? { by: row.approvedBy, at: row.approvedAt! } : null,
      rejected: row.rejectedBy
        ? { by: row.rejectedBy, at: row.rejectedAt!, reason: row.rejectionReason! }
        : null,
      lines: views,
      totalValue: sumValues(views.map((v) => v.value)),
    };
  }

  async create(
    dto: CreateStockAdjustmentDto,
    actor: AuthenticatedUser,
  ): Promise<StockAdjustmentView> {
    const location = await this.usableLocation(dto.locationId);
    labelRequestLocation(location.code);
    const lines = await this.validLines(location.id, dto.lines);
    const id = await this.prisma.$transaction(async (tx) => {
      const document = await this.ledger.createDraft(
        tx,
        'stock_adjustment',
        { businessDate: dto.businessDate ?? this.ledger.today(), note: dto.note ?? null },
        actor,
      );
      await tx.stockAdjustment.create({
        data: { documentId: document.id, locationId: location.id },
      });
      await this.writeLines(tx, document.id, lines);
      return document.id;
    });
    return this.get(id);
  }

  /**
   * Changes a draft. The lines are checked against the location they will be at: moving the
   * draft to another location checks its lines again, since a lot held at one location may
   * never have been at the other.
   */
  async update(id: string, dto: UpdateStockAdjustmentDto): Promise<StockAdjustmentView> {
    const current = await this.existing(id);
    const location = dto.locationId ? await this.usableLocation(dto.locationId) : undefined;
    const lines =
      dto.lines || location
        ? await this.validLines(location?.id ?? current.locationId, dto.lines ?? current.lines)
        : undefined;
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockDraft(tx, id, dto.revision);
      await this.ledger.updateDraft(tx, doc, {
        ...(dto.businessDate !== undefined ? { businessDate: dto.businessDate } : {}),
        ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
      });
      if (location) {
        await tx.stockAdjustment.update({
          where: { documentId: id },
          data: { locationId: location.id },
        });
      }
      if (lines) {
        await tx.stockAdjustmentLine.deleteMany({ where: { documentId: id } });
        await this.writeLines(tx, id, lines);
      }
    });
    return this.get(id);
  }

  /**
   * Hands a draft to an approver. It is checked as posting would check it, so an approver is
   * never shown an adjustment that could not post as it stands; from here its lines are fixed.
   */
  async submit(
    id: string,
    dto: StockAdjustmentStepDto,
    actor: AuthenticatedUser,
  ): Promise<StockAdjustmentView> {
    await this.existing(id);
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      assertStep(doc, 'submit');
      const refusal = await this.refusal(tx, doc);
      if (refusal) {
        throw new PostingRefusedError(
          refusal.rule,
          refusal.lineNo === undefined ? {} : { lineNo: refusal.lineNo },
        );
      }
      await this.ledger.moveTo(tx, doc, 'submitted');
      await tx.stockAdjustment.update({
        where: { documentId: id },
        data: { submittedById: actor.userId, submittedAt: new Date() },
      });
    });
    return this.get(id);
  }

  /**
   * Approves a submitted adjustment and posts it. Nobody approves a document they created,
   * whatever roles they hold (ADR-0008): refused here, counted and logged like any refusal,
   * and refused again by the database. The approval is audited in its own transaction; the
   * posting follows in the ledger's. When the ledger refuses (the stock has gone since it was
   * submitted), the adjustment stays approved and the answer says why.
   */
  async approve(
    id: string,
    dto: StockAdjustmentStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ApprovedStockAdjustmentView> {
    await this.existing(id);
    let number = '';
    let revision = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        const doc = await this.ledger.lockAt(tx, id, dto.revision);
        number = doc.number;
        assertStep(doc, 'approve');
        const problem = segregationProblem(doc, actor.userId);
        if (problem) throw new PostingRefusedError(problem);

        await this.ledger.moveTo(tx, doc, 'approved');
        await tx.stockAdjustment.update({
          where: { documentId: id },
          data: { approvedById: actor.userId, approvedAt: new Date() },
        });
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.APPROVE,
          entityType: 'StockAdjustment',
          entityId: id,
          summary: `Approved stock adjustment ${doc.number}`,
          changes: { status: { from: doc.status, to: 'approved' } },
          ...meta,
        });
        revision = doc.revision + 1;
      });
    } catch (error) {
      if (error instanceof PostingRefusedError) {
        this.ledger.recordTypeRefusal('stock_adjustment', number, error);
      }
      throw error;
    }
    this.logger.write({
      severity: 'INFO',
      event: 'document.approved',
      message: `Approved ${number}`,
      labels: { document_number: number },
    });

    let postingRefusal: ApprovedStockAdjustmentView['postingRefusal'] = null;
    try {
      await this.ledger.post(id, revision, actor, (tx, doc) => this.plan(tx, doc), {
        from: 'approved',
      });
    } catch (error) {
      if (!(error instanceof PostingRefusedError)) throw error;
      postingRefusal = {
        rule: error.rule,
        message: error.message,
        details: error.details ?? {},
      };
    }
    return { ...(await this.get(id)), postingRefusal };
  }

  /** Posts an approved adjustment the ledger refused before; refused again if still so. */
  async post(
    id: string,
    dto: StockAdjustmentStepDto,
    actor: AuthenticatedUser,
  ): Promise<StockAdjustmentView> {
    await this.existing(id);
    await this.ledger.post(id, dto.revision, actor, (tx, doc) => this.plan(tx, doc), {
      from: 'approved',
    });
    return this.get(id);
  }

  /**
   * Turns down a submitted adjustment, or an approved one the ledger refused to post, with a
   * reason for the person who raised it. Rejected is final: a corrected adjustment is a new one.
   */
  async reject(
    id: string,
    dto: RejectStockAdjustmentDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<StockAdjustmentView> {
    await this.existing(id);
    if (dto.reason.length === 0) {
      throw new BusinessRuleError(
        'REJECTION_REASON_MISSING',
        'Say why the adjustment is rejected, for the person who raised it',
      );
    }
    let number = '';
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      number = doc.number;
      assertStep(doc, 'reject');
      await this.ledger.moveTo(tx, doc, 'rejected');
      await tx.stockAdjustment.update({
        where: { documentId: id },
        data: { rejectedById: actor.userId, rejectedAt: new Date(), rejectionReason: dto.reason },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.REJECT,
        entityType: 'StockAdjustment',
        entityId: id,
        summary: `Rejected stock adjustment ${doc.number}`,
        changes: { status: { from: doc.status, to: 'rejected' }, reason: dto.reason },
        ...meta,
      });
    });
    this.logger.write({
      severity: 'INFO',
      event: 'document.rejected',
      message: `Rejected ${number}`,
      labels: { document_number: number },
    });
    return this.get(id);
  }

  /** Run by the ledger inside the posting transaction, with the document locked. */
  private async plan(tx: Tx, doc: LockedDocument): Promise<PostingPlan> {
    const { refusal, locationId, lines } = await this.check(tx, doc);
    if (refusal) return { refusal };
    return { lotChanges: lines.map((line) => ({ ...line, locationId })) };
  }

  private async refusal(tx: Tx, doc: LockedDocument): Promise<Refusal | null> {
    return (await this.check(tx, doc)).refusal;
  }

  /** The adjustment as stored, judged by the posting rules on today's facts. */
  private async check(
    tx: Tx,
    doc: LockedDocument,
  ): Promise<{ refusal: Refusal | null; locationId: string; lines: StoredLine[] }> {
    const row = await tx.stockAdjustment.findUniqueOrThrow({
      where: { documentId: doc.id },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    const lines = row.lines.map(storedLine);
    const [locations, items, lots] = await Promise.all([
      this.locations.describe([row.locationId], tx),
      this.items.describe(
        lines.map((l) => l.itemId),
        tx,
      ),
      this.ledger.lotFacts(
        lines.map((l) => l.lotId),
        tx,
      ),
    ]);
    const location = locations.get(row.locationId)!;
    labelRequestLocation(location.code);
    const refusal = postingRefusal(
      {
        businessDate: doc.businessDate,
        location,
        lines: lines.map((line) => ({
          ...line,
          item: items.get(line.itemId)!,
          lot: lots.get(line.lotId)!,
        })),
      },
      this.ledger.today(),
    );
    return { refusal, locationId: row.locationId, lines };
  }

  /** The adjustment's location and lines, labelling the request with its location. */
  private async existing(
    id: string,
  ): Promise<{ locationId: string; lines: StockAdjustmentLineDto[] }> {
    const found = await this.prisma.stockAdjustment.findUnique({
      where: { documentId: id },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!found) throw new NotFoundError('Stock adjustment', id);
    const location = (await this.locations.describe([found.locationId])).get(found.locationId);
    if (location) labelRequestLocation(location.code);
    return {
      locationId: found.locationId,
      lines: found.lines.map(storedLine).map((line) => ({
        lotId: line.lotId,
        quantity: line.quantity,
        secondaryQuantity: line.secondaryQuantity,
        reason: line.reason,
      })),
    };
  }

  private async usableLocation(id: string): Promise<LocationFacts> {
    const location = (await this.locations.describe([id])).get(id);
    if (!location) {
      throw new BusinessRuleError('UNKNOWN_LOCATION', `There is no location '${id}'`);
    }
    const problem = locationProblem(location);
    if (problem) {
      throw new BusinessRuleError('LOCATION_NOT_ALLOWED', LOCATION_ERRORS[problem], { problem });
    }
    return location;
  }

  /**
   * Each line checked against its lot and the lot's item; the first problem is refused, naming
   * its line. A lot is adjusted only where it has been held, and only once per adjustment.
   */
  private async validLines(
    locationId: string,
    lines: StockAdjustmentLineDto[],
  ): Promise<StoredLine[]> {
    const lotIds = lines.map((l) => l.lotId);
    const [lots, held] = await Promise.all([
      this.ledger.lotFacts(lotIds),
      this.ledger.heldAt(locationId, lotIds),
    ]);
    const items = await this.items.describe([...lots.values()].map((lot) => lot.itemId));
    const seen = new Set<string>();
    return lines.map((dto, index) => {
      const lineNo = index + 1;
      const lot = lots.get(dto.lotId);
      if (!lot) {
        throw new BusinessRuleError('UNKNOWN_LOT', `There is no lot '${dto.lotId}'`, { lineNo });
      }
      if (seen.has(lot.id)) {
        throw new BusinessRuleError(
          'DUPLICATE_LOT',
          `Lot ${lot.number} is on more than one line; put its whole change on one line`,
          { lineNo, lotNumber: lot.number },
        );
      }
      seen.add(lot.id);
      if (!held.has(lot.id)) {
        throw new BusinessRuleError(
          'LOT_NOT_AT_LOCATION',
          `Lot ${lot.number} has never been held at this location`,
          { lineNo, lotNumber: lot.number },
        );
      }
      const item = items.get(lot.itemId)!;
      if (!item.active) {
        throw new BusinessRuleError('ITEM_INACTIVE', `${item.code} is no longer in use`, {
          lineNo,
        });
      }
      const line = {
        quantity: dto.quantity,
        secondaryQuantity: dto.secondaryQuantity ?? null,
        reason: dto.reason,
      };
      const problem = lineProblem(line, item);
      if (problem) {
        throw new BusinessRuleError(
          'INVALID_STOCK_ADJUSTMENT_LINE',
          `Line ${lineNo} (${item.code}, lot ${lot.number}) is not valid: ${problem}`,
          { lineNo, problem },
        );
      }
      return { lineNo, lotId: lot.id, itemId: item.id, ...line, reason: line.reason.trim() };
    });
  }

  private async writeLines(tx: Tx, documentId: string, lines: StoredLine[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.stockAdjustmentLine.createMany({
      data: lines.map((line) => ({
        documentId,
        lineNo: line.lineNo,
        lotId: line.lotId,
        itemId: line.itemId,
        quantity: line.quantity,
        secondaryQuantity: line.secondaryQuantity,
        reason: line.reason,
      })),
    });
  }
}

function assertStep(doc: LockedDocument, step: Step): void {
  if (!stepAllowed(doc.status as AdjustmentStatus, step)) {
    throw new DomainError('STEP_NOT_ALLOWED', STEP_ERRORS[step], HttpStatus.CONFLICT, {
      status: doc.status,
      step,
    });
  }
}

function storedLine(row: {
  lineNo: number;
  lotId: string;
  itemId: string;
  quantity: Prisma.Decimal;
  secondaryQuantity: Prisma.Decimal | null;
  reason: string;
}): StoredLine {
  return {
    lineNo: row.lineNo,
    lotId: row.lotId,
    itemId: row.itemId,
    quantity: row.quantity.toFixed(),
    secondaryQuantity: row.secondaryQuantity?.toFixed() ?? null,
    reason: row.reason,
  };
}

function lineView(line: StoredLine, item: ItemFacts, lot: LotFacts): StockAdjustmentLineView {
  return {
    lineNo: line.lineNo,
    item: {
      id: item.id,
      code: item.code,
      nameTh: item.nameTh,
      nameEn: item.nameEn,
      baseUnitCode: item.baseUnitCode,
      variableWeight: item.variableWeight,
    },
    lot: { id: lot.id, number: lot.number, expiryDate: lot.expiryDate },
    quantity: formatQuantity(line.quantity, item.baseUnitDecimals),
    secondaryQuantity: line.secondaryQuantity,
    unitCost: lot.unitCost,
    value: stockValue(line.quantity, lot.unitCost),
    reason: line.reason,
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

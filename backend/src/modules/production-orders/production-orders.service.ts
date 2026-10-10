// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { BusinessRuleError, DomainError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  add,
  formatFixed,
  formatMinimal,
  negate,
  parseDecimal,
  ZERO,
  type ExactDecimal,
} from '../../core/quantity/domain/exact-decimal';
import {
  formatQuantity,
  normaliseDecimal,
  stockValue,
  sumValues,
} from '../../core/quantity/domain/stock-value';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { fefoPick, isExpired } from '../../core/stock/domain/fefo';
import { MetricsService } from '../../core/telemetry/metrics.service';
import { labelRequestDocument, labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { AuditService } from '../audit/audit.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import {
  LedgerService,
  type DocumentRef,
  type GenealogyLink,
  type LockedDocument,
  type LotFacts,
  type PostingPlan,
  type ProductionPosting,
  type StockedLot,
} from '../ledger/ledger.service';
import { LocationsService, type LocationFacts } from '../locations/locations.service';
import {
  ProductionBomsService,
  type BomVersionForOrder,
} from '../production-boms/production-boms.service';
import {
  actualProblem,
  allocateCost,
  isWeightUnit,
  measuredWeightKg,
  outputExpiry,
  plannedLines,
  plannedQuantityProblem,
  productionYield,
  type ActualProblem,
  type CostedOutput,
  type OutputExpiry,
} from './domain/production-rules';
import type {
  AvailableLotView,
  BomRef,
  CancelProductionOrderDto,
  CreateProductionOrderDto,
  CostView,
  InputLineView,
  ItemRef,
  LocationRef,
  OutputLineView,
  PickView,
  PostingCheck,
  ProductionOrderStepDto,
  ProductionOrderSummary,
  ProductionOrderView,
  ProductionOrdersQueryDto,
  RecordActualsDto,
  ReverseProductionOrderDto,
  UpdateProductionOrderDto,
} from './dto/production-orders.dto';

type Tx = Prisma.TransactionClient;

type Step = 'edit' | 'release' | 'record' | 'post' | 'cancel';

const STEP_ERRORS: Record<Step, string> = {
  edit: 'Only a draft can be edited: this order has already been released',
  release: 'Only a draft can be released',
  record: 'Lots and actuals are recorded on a released order, before it posts',
  post: 'Only a released production order can be posted',
  cancel: 'Only a draft or released order can be cancelled; a posted one is reversed',
};

const STEP_FROM: Record<Step, readonly string[]> = {
  edit: ['draft'],
  release: ['draft'],
  record: ['released'],
  post: ['released'],
  cancel: ['draft', 'released'],
};

const ACTUAL_ERRORS: Record<ActualProblem, string> = {
  not_a_decimal: 'must be a number',
  negative: 'cannot be below zero',
  too_many_decimals: 'has more decimals than its unit allows',
  too_large: 'is too large',
  pieces_not_allowed: 'a piece count is recorded only for variable-weight items',
  pieces_invalid: 'a piece count is a whole number, not below zero',
  weight_not_needed: 'an item counted in kg or g weighs its quantity: record no separate weight',
  weight_invalid: 'the weight is a number of kg, not below zero, to the gram',
};

const PERSON = { select: { id: true, displayName: true } } as const;

const ORDER_INCLUDE = {
  inputs: {
    orderBy: { lineNo: 'asc' },
    include: { picks: { orderBy: { lotId: 'asc' } } },
  },
  outputs: { orderBy: { lineNo: 'asc' } },
  releasedBy: PERSON,
  cancelledBy: PERSON,
} satisfies Prisma.ProductionOrderInclude;

type OrderRow = Prisma.ProductionOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/** A pick with the facts of its lot. */
interface CostedPick {
  inputLineNo: number;
  lotId: string;
  number: string;
  itemId: string;
  expiryDate: string;
  unitCost: string;
  quantity: string;
  pieces: string | null;
}

/** What the order adds up to now: what refuses it, and what posting would write. */
interface Assessment {
  blockers: PostingCheck[];
  picks: CostedPick[];
  inputValue: string;
  /** Per output in line order; null while any output or pick is missing. */
  costs: CostedOutput[] | null;
  /** Per output; null while nothing is picked. */
  expiries: OutputExpiry[] | null;
  yields: ReturnType<typeof productionYield>;
}

/**
 * Production orders (#13; ADR-0004, ADR-0006, ADR-0014, ADR-0027). A plant supervisor raises one
 * from the BOM version in force on its business date with a planned quantity of the BOM's first
 * input; releasing it picks input lots first-expired-first-out, which the supervisor may change,
 * never to an expired lot; they record what really came out; and posting turns the picked input
 * lots into one output lot per output, all in the ledger's one transaction: the input value split
 * by the BOM's ratios and divided by what came out, the output's expiry capped by the earliest
 * input lot, and genealogy from every output lot to every input lot. Posted orders are corrected
 * only by reversal.
 */
@Injectable()
export class ProductionOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly boms: ProductionBomsService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
    metrics: MetricsService,
  ) {
    metrics.gaugeFromDatabase(
      'erp_production_yield_percent',
      'Yield of the most recent posted, unreversed production order of each BOM, measured and as the BOM expects it.',
      ['bom_code', 'measure'],
      () => this.latestYields(),
    );
  }

  // --- reading ---------------------------------------------------------------------

  async list(query: ProductionOrdersQueryDto): Promise<ProductionOrderSummary[]> {
    const rows = await this.prisma.productionOrder.findMany({
      where: query.bomId ? { bomVersion: { bomId: query.bomId } } : {},
      select: {
        documentId: true,
        bomVersionId: true,
        locationId: true,
        plannedQuantity: true,
        actualYieldPercent: true,
        expectedYieldPercent: true,
        inputs: { where: { lineNo: 1 }, select: { itemId: true } },
      },
    });
    const [documents, versions, locations] = await Promise.all([
      this.ledger.documents(rows.map((r) => r.documentId)),
      this.boms.versionsForOrders(rows.map((r) => r.bomVersionId)),
      this.locations.describe(rows.map((r) => r.locationId)),
    ]);
    const items = await this.items.describe(rows.flatMap((r) => r.inputs.map((i) => i.itemId)));
    return rows
      .map((row) => ({ row, document: documents.get(row.documentId)! }))
      .filter(({ document }) => query.status === 'all' || document.status === query.status)
      .map(({ row, document }) => {
        const version = versions.get(row.bomVersionId)!;
        const item = items.get(row.inputs[0]?.itemId ?? version.inputs[0].itemId)!;
        const expected =
          row.expectedYieldPercent?.toFixed(2) ??
          productionYield({
            inputWeightKg: null,
            outputWeightsKg: [],
            expected: version.expected,
          }).overall.expected;
        const actual = row.actualYieldPercent?.toFixed(2) ?? null;
        return {
          ...document,
          bom: bomRef(version),
          location: locationRef(locations.get(row.locationId)!),
          plannedQuantity: formatQuantity(row.plannedQuantity.toFixed(), item.baseUnitDecimals),
          plannedItem: itemRef(item),
          yield: {
            expected,
            actual,
            difference: actual === null ? null : difference(actual, expected),
          },
        };
      })
      .sort((a, b) => b.number.localeCompare(a.number));
  }

  async get(id: string, label = true): Promise<ProductionOrderView> {
    const row = await this.prisma.productionOrder.findUnique({
      where: { documentId: id },
      include: ORDER_INCLUDE,
    });
    if (!row) throw new NotFoundError('Production order', id);
    const document = await this.ledger.document(id);
    const version = (await this.boms.versionsForOrders([row.bomVersionId])).get(row.bomVersionId)!;
    const location = (await this.locations.describe([row.locationId])).get(row.locationId)!;
    if (label) {
      labelRequestDocument(document.number);
      labelRequestLocation(location.code);
    }
    const items = await this.itemsOf(version);
    const open = document.status === 'draft' || document.status === 'released';
    const available = open
      ? await this.ledger.lotsAt(
          row.locationId,
          version.inputs.map((l) => l.itemId),
        )
      : [];

    // A draft shows what FEFO would take now; later the order shows what it recorded.
    const pickRows =
      document.status === 'draft'
        ? this.suggestedPicks(row, available, document.businessDate)
        : row.inputs.flatMap((input) =>
            input.picks.map((p) => ({
              inputLineNo: input.lineNo,
              lotId: p.lotId,
              quantity: p.quantity.toFixed(),
              pieces: p.secondaryQuantity?.toFixed() ?? null,
            })),
          );
    const facts = await this.ledger.lotFacts(pickRows.map((p) => p.lotId));
    const assessment = assess(row, version, items, pickRows, facts, document.businessDate);
    const [lots, genealogy] = await Promise.all([
      document.status === 'posted' ? this.ledger.lotsOf(id) : Promise.resolve([]),
      document.status === 'posted'
        ? this.ledger.genealogy({ documentId: id })
        : Promise.resolve<GenealogyLink[]>([]),
    ]);
    const lotByLine = new Map(lots.map((lot) => [lot.lineNo, lot]));

    const inputs: InputLineView[] = row.inputs.map((input) => {
      const item = items.get(input.itemId)!;
      const picks = assessment.picks.filter((p) => p.inputLineNo === input.lineNo);
      const quantity = picks.map((p) => decimal(p.quantity)).reduce(add, ZERO);
      return {
        lineNo: input.lineNo,
        item: itemRef(item),
        plannedQuantity: formatQuantity(input.plannedQuantity.toFixed(), item.baseUnitDecimals),
        picks: picks.map(pickView),
        picksOverridden: input.picksOverridden,
        shortBy: open
          ? formatMinimal(maxZero(add(decimal(input.plannedQuantity.toFixed()), negate(quantity))))
          : null,
        quantity: formatMinimal(quantity),
        weightKg: input.actualWeightKg ? normaliseDecimal(input.actualWeightKg.toFixed()) : null,
        availableLots: available
          .filter((lot) => lot.itemId === input.itemId)
          .map((lot) => availableView(lot, document.businessDate)),
      };
    });

    const posted = document.status === 'posted';
    const outputs: OutputLineView[] = row.outputs.map((output, index) => {
      const item = items.get(output.itemId)!;
      const lot = lotByLine.get(row.inputs.length + output.lineNo) ?? null;
      const stored: CostView | null =
        posted && output.allocatedValue && output.roundingDifference && lot
          ? {
              allocatedValue: normaliseDecimal(output.allocatedValue.toFixed()),
              unitCost: lot.unitCost,
              lotValue: stockValue(lot.quantity, lot.unitCost),
              roundingDifference: normaliseDecimal(output.roundingDifference.toFixed()),
            }
          : null;
      return {
        lineNo: output.lineNo,
        item: itemRef(item),
        plannedQuantity: formatQuantity(output.plannedQuantity.toFixed(), item.baseUnitDecimals),
        allocationRatio: output.allocationRatio.toFixed(2),
        actualQuantity: output.actualQuantity
          ? formatQuantity(output.actualQuantity.toFixed(), item.baseUnitDecimals)
          : null,
        actualPieces: output.actualPieces?.toFixed() ?? null,
        actualWeightKg: output.actualWeightKg
          ? normaliseDecimal(output.actualWeightKg.toFixed())
          : null,
        yield: assessment.yields.outputs[index],
        cost: posted ? stored : (assessment.costs?.[index] ?? null),
        expiry: posted
          ? lot
            ? {
                expiryDate: lot.expiryDate,
                computedExpiryDate:
                  assessment.expiries?.[index]?.computedExpiryDate ?? lot.expiryDate,
                earliestInputExpiryDate:
                  assessment.expiries?.[index]?.earliestInputExpiryDate ?? lot.expiryDate,
              }
            : null
          : (assessment.expiries?.[index] ?? null),
        lot: lot ? { id: lot.id, number: lot.number } : null,
      };
    });

    return {
      ...document,
      bom: bomRef(version),
      location: locationRef(location),
      plannedQuantity: formatQuantity(
        row.plannedQuantity.toFixed(),
        items.get(version.inputs[0].itemId)!.baseUnitDecimals,
      ),
      released: row.releasedBy ? { by: row.releasedBy, at: row.releasedAt! } : null,
      cancelled: row.cancelledBy
        ? { by: row.cancelledBy, at: row.cancelledAt!, reason: row.cancellationReason! }
        : null,
      inputs,
      outputs,
      yield: posted
        ? {
            expected: row.expectedYieldPercent!.toFixed(2),
            actual: row.actualYieldPercent!.toFixed(2),
            difference: difference(
              row.actualYieldPercent!.toFixed(2),
              row.expectedYieldPercent!.toFixed(2),
            ),
          }
        : assessment.yields.overall,
      inputValue: assessment.inputValue,
      blockers: open ? assessment.blockers : [],
      genealogy,
    };
  }

  /** Genealogy touching a lot; a trace leaves out links of reversed orders unless asked. */
  lotGenealogy(lotId: string, includeReversed: boolean): Promise<GenealogyLink[]> {
    return this.ledger.genealogy({ lotId }, { current: !includeReversed });
  }

  // --- planning --------------------------------------------------------------------

  async create(
    dto: CreateProductionOrderDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionOrderView> {
    const businessDate = dto.businessDate ?? this.ledger.today();
    const plan = await this.plan(dto.bomId, dto.locationId, dto.plannedQuantity, businessDate);
    labelRequestLocation(plan.location.code);
    const id = await this.prisma.$transaction(async (tx) => {
      const document = await this.ledger.createDraft(
        tx,
        'production_order',
        { businessDate, note: dto.note ?? null },
        actor,
      );
      labelRequestDocument(document.number);
      await tx.productionOrder.create({
        data: {
          documentId: document.id,
          bomVersionId: plan.version.version.id,
          locationId: plan.location.id,
          plannedQuantity: plan.plannedQuantity,
        },
      });
      await this.writePlan(tx, document.id, plan);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'ProductionOrder',
        entityId: document.id,
        summary: `Drafted production order ${document.number} from BOM ${plan.version.bom.code} version ${plan.version.version.number}`,
        changes: {
          status: { from: null, to: 'draft' },
          bomVersion: plan.version.version.number,
          plannedQuantity: plan.plannedQuantity,
        },
        ...meta,
      });
      return document.id;
    });
    return this.get(id);
  }

  /** Changes a draft; its plan is worked out again from the version in force on its date. */
  async update(
    id: string,
    dto: UpdateProductionOrderDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionOrderView> {
    const existing = await this.existing(id);
    const document = await this.ledger.document(id);
    const businessDate = dto.businessDate ?? document.businessDate;
    const plan = await this.plan(
      existing.bomId,
      dto.locationId ?? existing.locationId,
      dto.plannedQuantity ?? existing.plannedQuantity,
      businessDate,
    );
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      assertStep(doc, 'edit');
      await this.ledger.updateDraft(tx, doc, {
        ...(dto.businessDate !== undefined ? { businessDate: dto.businessDate } : {}),
        ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
      });
      await tx.productionOrder.update({
        where: { documentId: id },
        data: {
          bomVersionId: plan.version.version.id,
          locationId: plan.location.id,
          plannedQuantity: plan.plannedQuantity,
        },
      });
      await tx.productionOrderInput.deleteMany({ where: { documentId: id } });
      await tx.productionOrderOutput.deleteMany({ where: { documentId: id } });
      await this.writePlan(tx, id, plan);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'ProductionOrder',
        entityId: id,
        summary: `Edited draft production order ${doc.number}`,
        changes: { fields: Object.keys(dto).filter((key) => key !== 'revision') },
        ...meta,
      });
    });
    return this.get(id);
  }

  // --- steps -----------------------------------------------------------------------

  /**
   * Releases a draft to the plant floor: its BOM version, plant and plan are fixed, and each
   * input's lots are picked first-expired-first-out from the plant's stock on its business date.
   * What FEFO cannot cover stays short; the supervisor sees it and may pick other lots.
   */
  async release(
    id: string,
    dto: ProductionOrderStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionOrderView> {
    await this.existing(id);
    let number = '';
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      number = doc.number;
      assertStep(doc, 'release');
      const row = await tx.productionOrder.findUniqueOrThrow({
        where: { documentId: id },
        include: ORDER_INCLUDE,
      });
      const location = await this.plantLocation(row.locationId);
      const available = await this.ledger.lotsAt(
        row.locationId,
        row.inputs.map((i) => i.itemId),
        tx,
      );
      const picks = this.suggestedPicks(row, available, doc.businessDate);
      if (picks.length > 0) {
        await tx.productionOrderPick.createMany({
          data: picks.map((p) => ({
            documentId: id,
            inputLineNo: p.inputLineNo,
            lotId: p.lotId,
            quantity: p.quantity,
            secondaryQuantity: p.pieces,
          })),
        });
      }
      await tx.productionOrder.update({
        where: { documentId: id },
        data: { releasedById: actor.userId, releasedAt: new Date() },
      });
      await this.ledger.moveTo(tx, doc, 'released');
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'ProductionOrder',
        entityId: id,
        summary: `Released production order ${doc.number} at ${location.code}: ${picks.length} lots picked FEFO`,
        changes: { status: { from: 'draft', to: 'released' }, picks: picks.length },
        ...meta,
      });
    });
    this.logger.write({
      severity: 'INFO',
      event: 'app.log',
      message: `Released ${number}`,
      labels: { document_number: number },
    });
    return this.get(id);
  }

  /**
   * Records the lots each input is taken from (overriding FEFO, never with a lot expired on the
   * order's business date) and what each output really yielded. Nothing posts: the order shows
   * its yield and costs, and what still refuses it.
   */
  async recordActuals(
    id: string,
    dto: RecordActualsDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionOrderView> {
    await this.existing(id);
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      assertStep(doc, 'record');
      const row = await tx.productionOrder.findUniqueOrThrow({
        where: { documentId: id },
        include: ORDER_INCLUDE,
      });
      const version = (await this.boms.versionsForOrders([row.bomVersionId])).get(
        row.bomVersionId,
      )!;
      const items = await this.itemsOf(version);
      const changedInputs = await this.checkInputs(tx, row, dto, items, doc.businessDate);
      const changedOutputs = checkOutputs(row, dto, items);

      for (const input of changedInputs) {
        const before = row.inputs.find((i) => i.lineNo === input.lineNo)!;
        const overridden = before.picksOverridden || !samePicks(before.picks, input.picks);
        await tx.productionOrderPick.deleteMany({
          where: { documentId: id, inputLineNo: input.lineNo },
        });
        if (input.picks.length > 0) {
          await tx.productionOrderPick.createMany({
            data: input.picks.map((p) => ({
              documentId: id,
              inputLineNo: input.lineNo,
              lotId: p.lotId,
              quantity: p.quantity,
              secondaryQuantity: p.pieces,
            })),
          });
        }
        await tx.productionOrderInput.update({
          where: { documentId_lineNo: { documentId: id, lineNo: input.lineNo } },
          data: { actualWeightKg: input.weightKg, picksOverridden: overridden },
        });
      }
      for (const output of changedOutputs) {
        await tx.productionOrderOutput.update({
          where: { documentId_lineNo: { documentId: id, lineNo: output.lineNo } },
          data: {
            actualQuantity: output.quantity,
            actualPieces: output.pieces,
            actualWeightKg: output.weightKg,
          },
        });
      }
      await this.ledger.updateDraft(tx, doc, {});
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'ProductionOrder',
        entityId: id,
        summary: `Recorded lots and actuals on production order ${doc.number}`,
        changes: {
          inputs: changedInputs.map((i) => ({
            lineNo: i.lineNo,
            picks: i.picks.map((p) => ({ lotId: p.lotId, quantity: p.quantity })),
          })),
          outputs: changedOutputs.map((o) => ({ lineNo: o.lineNo, quantity: o.quantity })),
        },
        ...meta,
      });
    });
    return this.get(id);
  }

  /**
   * Posts a released order in the ledger's one transaction: refused, counted and logged by rule
   * when anything is missing, an input lot has expired, or a plant lot would go below zero.
   */
  async post(
    id: string,
    dto: ProductionOrderStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionOrderView> {
    await this.existing(id);
    await this.ledger.post(
      id,
      dto.revision,
      actor,
      (tx, doc) => this.postingPlan(tx, doc, actor, meta),
      { from: 'released', notReady: 'not_released' },
    );
    return this.get(id);
  }

  /** Cancels a draft or released order with a reason. Final: nothing was ever posted. */
  async cancel(
    id: string,
    dto: CancelProductionOrderDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ProductionOrderView> {
    await this.existing(id);
    if (dto.reason.length === 0) {
      throw new BusinessRuleError(
        'CANCELLATION_REASON_MISSING',
        'Say why the order is cancelled, for whoever planned it',
      );
    }
    let number = '';
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      number = doc.number;
      assertStep(doc, 'cancel');
      await tx.productionOrder.update({
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
        entityType: 'ProductionOrder',
        entityId: id,
        summary: `Cancelled production order ${doc.number}`,
        changes: { status: { from: doc.status, to: 'cancelled' }, reason: dto.reason },
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

  /**
   * Reverses a posted order (#7): every entry negated exactly, so the inputs come back and the
   * output lots go to zero, refused if an output lot has moved on since. Its genealogy stays as
   * history and drops out of traces.
   */
  async reverse(
    id: string,
    dto: ReverseProductionOrderDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<{ order: ProductionOrderView; reversal: DocumentRef }> {
    const { number } = await this.existing(id);
    const reversal = await this.ledger.reverse(
      id,
      { businessDate: dto.businessDate, note: dto.note ?? null },
      actor,
    );
    await this.audit.record({
      actorUserId: actor.userId,
      action: AuditAction.CREATE,
      entityType: 'ProductionOrder',
      entityId: id,
      summary: `Reversed production order ${number} with ${reversal.number}`,
      changes: { reversal: reversal.number },
      ...meta,
    });
    return { order: await this.get(id), reversal };
  }

  // --- posting ---------------------------------------------------------------------

  /**
   * Run by the ledger inside the posting transaction, with the order locked: checks the order as
   * it stands, fixes each output's allocation and the order's yields, and hands the ledger the
   * lots to consume, the lots to create and the genealogy between them.
   */
  private async postingPlan(
    tx: Tx,
    doc: LockedDocument,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PostingPlan> {
    const row = await tx.productionOrder.findUniqueOrThrow({
      where: { documentId: doc.id },
      include: ORDER_INCLUDE,
    });
    const location = await this.plantLocation(row.locationId);
    labelRequestLocation(location.code);
    const version = (await this.boms.versionsForOrders([row.bomVersionId])).get(row.bomVersionId)!;
    const items = await this.itemsOf(version);
    const pickRows = row.inputs.flatMap((input) =>
      input.picks.map((p) => ({
        inputLineNo: input.lineNo,
        lotId: p.lotId,
        quantity: p.quantity.toFixed(),
        pieces: p.secondaryQuantity?.toFixed() ?? null,
      })),
    );
    const facts = await this.ledger.lotFacts(
      pickRows.map((p) => p.lotId),
      tx,
    );
    const assessment = assess(row, version, items, pickRows, facts, doc.businessDate);
    const inactive = row.outputs.find((o) => !items.get(o.itemId)!.active);
    if (inactive) return { refusal: { rule: 'inactive_item', lineNo: inactive.lineNo } };
    const blocker = assessment.blockers[0];
    if (blocker) return { refusal: { rule: blocker.rule, lineNo: blocker.lineNo } };
    const costs = assessment.costs!;
    const expiries = assessment.expiries!;

    const posting: ProductionPosting = {
      consumed: assessment.picks.map((p) => ({
        lineNo: p.inputLineNo,
        lotId: p.lotId,
        itemId: p.itemId,
        locationId: row.locationId,
        quantity: formatMinimal(negate(decimal(p.quantity))),
        secondaryQuantity: p.pieces === null ? null : formatMinimal(negate(decimal(p.pieces))),
      })),
      newLots: row.outputs.map((output, index) => ({
        lineNo: row.inputs.length + output.lineNo,
        itemId: output.itemId,
        locationId: row.locationId,
        quantity: normaliseDecimal(output.actualQuantity!.toFixed()),
        secondaryQuantity: output.actualPieces?.toFixed() ?? null,
        unitCost: costs[index].unitCost,
        expiryDate: expiries[index].expiryDate,
      })),
      genealogy: row.outputs.flatMap((output) =>
        consumedPerLot(assessment.picks).map((consumed) => ({
          outputLineNo: row.inputs.length + output.lineNo,
          inputLotId: consumed.lotId,
          inputQuantity: consumed.quantity,
        })),
      ),
    };

    for (const [index, output] of row.outputs.entries()) {
      await tx.productionOrderOutput.update({
        where: { documentId_lineNo: { documentId: doc.id, lineNo: output.lineNo } },
        data: {
          allocatedValue: costs[index].allocatedValue,
          roundingDifference: costs[index].roundingDifference,
        },
      });
    }
    await tx.productionOrder.update({
      where: { documentId: doc.id },
      data: {
        actualYieldPercent: assessment.yields.overall.actual!,
        expectedYieldPercent: assessment.yields.overall.expected,
      },
    });
    await this.audit.recordWithin(tx, {
      actorUserId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'ProductionOrder',
      entityId: doc.id,
      summary: `Posted production order ${doc.number}: yield ${assessment.yields.overall.actual} % against ${assessment.yields.overall.expected} % expected`,
      changes: {
        status: { from: 'released', to: 'posted' },
        inputValue: assessment.inputValue,
        outputs: row.outputs.map((o, i) => ({
          lineNo: o.lineNo,
          unitCost: costs[i].unitCost,
          roundingDifference: costs[i].roundingDifference,
        })),
      },
      ...meta,
    });
    return { production: posting };
  }

  // --- internals -------------------------------------------------------------------

  /** The order's BOM, plant and plan, refusing an unknown order early and labelling the request. */
  private async existing(id: string): Promise<{
    number: string;
    bomId: string;
    locationId: string;
    plannedQuantity: string;
  }> {
    const row = await this.prisma.productionOrder.findUnique({
      where: { documentId: id },
      select: {
        locationId: true,
        plannedQuantity: true,
        bomVersion: { select: { bomId: true } },
        document: { select: { number: true } },
      },
    });
    if (!row) throw new NotFoundError('Production order', id);
    labelRequestDocument(row.document.number);
    const location = (await this.locations.describe([row.locationId])).get(row.locationId);
    if (location) labelRequestLocation(location.code);
    return {
      number: row.document.number,
      bomId: row.bomVersion.bomId,
      locationId: row.locationId,
      plannedQuantity: row.plannedQuantity.toFixed(),
    };
  }

  /** The version in force, the plant and the planned lines, refusing what cannot be planned. */
  private async plan(bomId: string, locationId: string, quantity: string, businessDate: string) {
    const version = await this.boms.versionForOrder(bomId, businessDate);
    if (!version) {
      throw new BusinessRuleError(
        'NO_BOM_VERSION_IN_FORCE',
        `No version of this BOM is in force on ${businessDate}`,
        { businessDate },
      );
    }
    if (!version.bom.active) {
      throw new BusinessRuleError('BOM_INACTIVE', 'This BOM is no longer in use');
    }
    const location = await this.plantLocation(locationId);
    if (location.type !== version.locationType) {
      throw new BusinessRuleError(
        'WRONG_LOCATION_TYPE',
        `This BOM runs at a ${version.locationType}, not at ${location.code}`,
      );
    }
    const items = await this.itemsOf(version);
    const first = items.get(version.inputs[0].itemId)!;
    const problem = plannedQuantityProblem(quantity, first);
    if (problem) {
      throw new BusinessRuleError(
        'INVALID_PLANNED_QUANTITY',
        `The planned quantity of ${first.code} ${problem.replaceAll('_', ' ')}`,
        { field: 'plannedQuantity', problem },
      );
    }
    const lines = plannedLines(version.inputs, version.outputs, quantity, items);
    return { version, location, plannedQuantity: normaliseDecimal(quantity), lines };
  }

  private async writePlan(
    tx: Tx,
    documentId: string,
    plan: Awaited<ReturnType<ProductionOrdersService['plan']>>,
  ): Promise<void> {
    await tx.productionOrderInput.createMany({
      data: plan.version.inputs.map((line, index) => ({
        documentId,
        lineNo: line.lineNo,
        itemId: line.itemId,
        plannedQuantity: plan.lines.inputs[index].quantity,
      })),
    });
    await tx.productionOrderOutput.createMany({
      data: plan.version.outputs.map((line, index) => ({
        documentId,
        lineNo: line.lineNo,
        itemId: line.itemId,
        plannedQuantity: plan.lines.outputs[index].quantity,
        allocationRatio: line.allocationRatio,
      })),
    });
  }

  /** An active location; production runs at a plant. */
  private async plantLocation(locationId: string): Promise<LocationFacts> {
    const location = (await this.locations.describe([locationId])).get(locationId);
    if (!location) throw new NotFoundError('Location', locationId);
    if (!location.active) {
      throw new BusinessRuleError('LOCATION_INACTIVE', 'The location is no longer in use');
    }
    return location;
  }

  private itemsOf(version: BomVersionForOrder): Promise<Map<string, ItemFacts>> {
    return this.items.describe([...version.inputs, ...version.outputs].map((l) => l.itemId));
  }

  /** FEFO picks for each input's planned quantity from the lots there are. */
  private suggestedPicks(
    row: Pick<OrderRow, 'inputs'>,
    available: readonly StockedLot[],
    businessDate: string,
  ): Array<{ inputLineNo: number; lotId: string; quantity: string; pieces: string | null }> {
    return row.inputs.flatMap((input) => {
      const lots = available
        .filter((lot) => lot.itemId === input.itemId)
        .map((lot) => ({
          lotId: lot.lotId,
          number: lot.number,
          expiryDate: lot.expiryDate,
          available: lot.available,
        }));
      return fefoPick(lots, input.plannedQuantity.toFixed(), businessDate).picks.map((pick) => ({
        inputLineNo: input.lineNo,
        lotId: pick.lotId,
        quantity: pick.quantity,
        pieces: null,
      }));
    });
  }

  /** The inputs a record changes, checked: every lot of the input's item, at the plant, usable. */
  private async checkInputs(
    tx: Tx,
    row: OrderRow,
    dto: RecordActualsDto,
    items: ReadonlyMap<string, ItemFacts>,
    businessDate: string,
  ) {
    const given = dto.inputs ?? [];
    const lotIds = given.flatMap((i) => i.picks.map((p) => p.lotId));
    const [facts, held] = await Promise.all([
      this.ledger.lotFacts(lotIds, tx),
      this.ledger.heldAt(row.locationId, lotIds, tx),
    ]);
    const seenLines = new Set<number>();
    return given.map((input) => {
      const line = row.inputs.find((i) => i.lineNo === input.lineNo);
      if (!line || seenLines.has(input.lineNo)) {
        throw lineError(
          'input',
          input.lineNo,
          'is not an input line of this order, or is repeated',
        );
      }
      seenLines.add(input.lineNo);
      const item = items.get(line.itemId)!;
      const seenLots = new Set<string>();
      const picks = input.picks.map((pick) => {
        const lot = facts.get(pick.lotId);
        if (!lot || lot.itemId !== line.itemId || !held.has(pick.lotId)) {
          throw lineError(
            'input',
            input.lineNo,
            `lot ${lot?.number ?? pick.lotId} is not ${item.code} held at this plant`,
          );
        }
        if (seenLots.has(pick.lotId)) {
          throw lineError('input', input.lineNo, `lot ${lot.number} is picked twice`);
        }
        seenLots.add(pick.lotId);
        if (isExpired(lot.expiryDate, businessDate)) {
          throw new BusinessRuleError(
            'EXPIRED_LOT',
            `Lot ${lot.number} expired on ${lot.expiryDate}, before the order's business date: an expired lot cannot be used (ADR-0006)`,
            { side: 'input', lineNo: input.lineNo, lotNumber: lot.number },
          );
        }
        const quantity = parseDecimal(pick.quantity);
        const problem = actualProblem(
          { quantity: pick.quantity, pieces: pick.pieces ?? null, weightKg: null },
          item,
        );
        if (problem || !quantity || quantity.units <= 0n) {
          throw lineError(
            'input',
            input.lineNo,
            `the quantity taken from lot ${lot.number} ${problem ? ACTUAL_ERRORS[problem] : 'must be more than zero'}`,
          );
        }
        return {
          lotId: pick.lotId,
          quantity: formatMinimal(quantity),
          pieces: pick.pieces ? normaliseDecimal(pick.pieces) : null,
        };
      });
      const weightKg = input.weightKg ?? null;
      if (weightKg !== null) {
        const problem = actualProblem({ quantity: '0', pieces: null, weightKg }, item);
        if (problem) throw lineError('input', input.lineNo, ACTUAL_ERRORS[problem]);
      }
      return {
        lineNo: input.lineNo,
        picks,
        weightKg: weightKg === null ? null : normaliseDecimal(weightKg),
      };
    });
  }

  /** The latest posted, unreversed order of each BOM: its measured and expected yield. */
  private async latestYields(): Promise<
    Array<{ labels: { bom_code: string; measure: string }; value: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ bomCode: string; actual: string; expected: string }>
    >`
      SELECT DISTINCT ON (b."code") b."code" AS "bomCode",
             o."actual_yield_percent"::text AS "actual", o."expected_yield_percent"::text AS "expected"
      FROM "production_orders" o
      JOIN "stock_documents" d ON d."id" = o."document_id"
      JOIN "production_bom_versions" v ON v."id" = o."bom_version_id"
      JOIN "production_boms" b ON b."id" = v."bom_id"
      WHERE d."status" = 'posted' AND o."actual_yield_percent" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "stock_documents" r WHERE r."reverses_id" = d."id")
      ORDER BY b."code", d."business_date" DESC, d."posted_at" DESC
    `;
    return rows.flatMap((row) => [
      { labels: { bom_code: row.bomCode, measure: 'actual' }, value: Number(row.actual) },
      { labels: { bom_code: row.bomCode, measure: 'expected' }, value: Number(row.expected) },
    ]);
  }
}

/**
 * Everything the order adds up to as it stands, and in order what would refuse it: the first
 * blocker is the rule the posting is refused by.
 */
function assess(
  row: Pick<OrderRow, 'inputs' | 'outputs'>,
  version: BomVersionForOrder,
  items: ReadonlyMap<string, ItemFacts>,
  pickRows: ReadonlyArray<{
    inputLineNo: number;
    lotId: string;
    quantity: string;
    pieces: string | null;
  }>,
  facts: ReadonlyMap<string, LotFacts>,
  businessDate: string,
): Assessment {
  const blockers: PostingCheck[] = [];
  const picks: CostedPick[] = pickRows.flatMap((p) => {
    const lot = facts.get(p.lotId);
    return lot
      ? [
          {
            inputLineNo: p.inputLineNo,
            lotId: p.lotId,
            number: lot.number,
            itemId: lot.itemId,
            expiryDate: lot.expiryDate,
            unitCost: lot.unitCost,
            quantity: normaliseDecimal(p.quantity),
            pieces: p.pieces === null ? null : normaliseDecimal(p.pieces),
          },
        ]
      : [];
  });

  let inputWeight: ExactDecimal | null = ZERO;
  for (const input of row.inputs) {
    const item = items.get(input.itemId)!;
    const mine = picks.filter((p) => p.inputLineNo === input.lineNo);
    if (mine.length === 0)
      blockers.push({ rule: 'nothing_picked', side: 'input', lineNo: input.lineNo });
    const expired = mine.find((p) => isExpired(p.expiryDate, businessDate));
    if (expired) blockers.push({ rule: 'expired_lot', side: 'input', lineNo: input.lineNo });
    const quantity = formatMinimal(mine.map((p) => decimal(p.quantity)).reduce(add, ZERO));
    const weight = measuredWeightKg(
      quantity,
      input.actualWeightKg ? input.actualWeightKg.toFixed() : null,
      item,
    );
    if (weight === null) {
      blockers.push({ rule: 'weight_required', side: 'input', lineNo: input.lineNo });
      inputWeight = null;
    } else if (inputWeight !== null) {
      inputWeight = add(inputWeight, weight);
    }
  }

  const outputWeights: Array<ExactDecimal | null> = [];
  let complete = true;
  for (const output of row.outputs) {
    const item = items.get(output.itemId)!;
    if (output.actualQuantity === null) {
      blockers.push({ rule: 'actuals_missing', side: 'output', lineNo: output.lineNo });
      outputWeights.push(null);
      complete = false;
      continue;
    }
    if (item.variableWeight && output.actualPieces === null) {
      blockers.push({ rule: 'pieces_required', side: 'output', lineNo: output.lineNo });
    }
    const weight = measuredWeightKg(
      output.actualQuantity.toFixed(),
      output.actualWeightKg ? output.actualWeightKg.toFixed() : null,
      item,
    );
    if (weight === null) {
      blockers.push({ rule: 'weight_required', side: 'output', lineNo: output.lineNo });
    }
    outputWeights.push(weight);
  }

  const inputValue = sumValues(picks.map((p) => stockValue(p.quantity, p.unitCost)));
  let costs: CostedOutput[] | null = null;
  if (complete && picks.length > 0) {
    const allocation = allocateCost(
      picks,
      row.outputs.map((o) => ({
        ratio: o.allocationRatio.toFixed(2),
        quantity: o.actualQuantity!.toFixed(),
      })),
    );
    if (allocation.ok) costs = allocation.outputs;
    else {
      blockers.push({
        rule: 'zero_output_quantity',
        side: 'output',
        lineNo: row.outputs[allocation.outputIndex].lineNo,
      });
    }
  }
  const expiries =
    picks.length > 0
      ? row.outputs.map((o) =>
          outputExpiry(
            businessDate,
            items.get(o.itemId)!.shelfLifeDays,
            picks.map((p) => p.expiryDate),
          ),
        )
      : null;
  const yields = productionYield({
    inputWeightKg: inputWeight,
    outputWeightsKg: outputWeights,
    expected: version.expected,
  });
  return { blockers, picks, inputValue, costs, expiries, yields };
}

/** The outputs a record changes, checked against their items. */
function checkOutputs(row: OrderRow, dto: RecordActualsDto, items: ReadonlyMap<string, ItemFacts>) {
  const seen = new Set<number>();
  return (dto.outputs ?? []).map((output) => {
    const line = row.outputs.find((o) => o.lineNo === output.lineNo);
    if (!line || seen.has(output.lineNo)) {
      throw lineError(
        'output',
        output.lineNo,
        'is not an output line of this order, or is repeated',
      );
    }
    seen.add(output.lineNo);
    const item = items.get(line.itemId)!;
    const quantity = output.quantity ?? null;
    const pieces = output.pieces ?? null;
    const weightKg = output.weightKg ?? null;
    if (quantity === null) {
      if (pieces !== null || weightKg !== null) {
        throw lineError('output', output.lineNo, 'record the quantity with its pieces or weight');
      }
      return { lineNo: output.lineNo, quantity: null, pieces: null, weightKg: null };
    }
    const problem = actualProblem({ quantity, pieces, weightKg }, item);
    if (problem) throw lineError('output', output.lineNo, ACTUAL_ERRORS[problem]);
    return {
      lineNo: output.lineNo,
      quantity: normaliseDecimal(quantity),
      pieces: pieces === null ? null : normaliseDecimal(pieces),
      weightKg: weightKg === null ? null : normaliseDecimal(weightKg),
    };
  });
}

/** What the order takes of each lot, whichever input it is on. */
function consumedPerLot(picks: readonly CostedPick[]): Array<{ lotId: string; quantity: string }> {
  const byLot = new Map<string, ExactDecimal>();
  for (const pick of picks) {
    byLot.set(pick.lotId, add(byLot.get(pick.lotId) ?? ZERO, decimal(pick.quantity)));
  }
  return [...byLot].map(([lotId, quantity]) => ({ lotId, quantity: formatMinimal(quantity) }));
}

function samePicks(
  before: ReadonlyArray<{ lotId: string; quantity: Prisma.Decimal }>,
  after: ReadonlyArray<{ lotId: string; quantity: string }>,
): boolean {
  if (before.length !== after.length) return false;
  const key = (lotId: string, quantity: string) => `${lotId}|${normaliseDecimal(quantity)}`;
  const a = new Set(before.map((p) => key(p.lotId, p.quantity.toFixed())));
  return after.every((p) => a.has(key(p.lotId, p.quantity)));
}

function assertStep(doc: LockedDocument, step: Step): void {
  if (!STEP_FROM[step].includes(doc.status)) {
    throw new DomainError('STEP_NOT_ALLOWED', STEP_ERRORS[step], HttpStatus.CONFLICT, {
      status: doc.status,
      step,
    });
  }
}

function lineError(side: 'input' | 'output', lineNo: number, problem: string): BusinessRuleError {
  return new BusinessRuleError('INVALID_PRODUCTION_LINE', `${side} line ${lineNo}: ${problem}`, {
    side,
    lineNo,
  });
}

function pickView(pick: CostedPick): PickView {
  return {
    lotId: pick.lotId,
    number: pick.number,
    expiryDate: pick.expiryDate,
    quantity: pick.quantity,
    pieces: pick.pieces,
    unitCost: pick.unitCost,
    value: stockValue(pick.quantity, pick.unitCost),
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

function itemRef(item: ItemFacts): ItemRef {
  return {
    id: item.id,
    code: item.code,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    baseUnitCode: item.baseUnitCode,
    variableWeight: item.variableWeight,
    weighed: !isWeightUnit(item.baseUnitCode),
  };
}

function locationRef(location: LocationFacts): LocationRef {
  return {
    id: location.id,
    code: location.code,
    nameTh: location.nameTh,
    nameEn: location.nameEn,
  };
}

function bomRef(version: BomVersionForOrder): BomRef {
  return {
    id: version.bom.id,
    code: version.bom.code,
    nameTh: version.bom.nameTh,
    nameEn: version.bom.nameEn,
    version: version.version,
  };
}

/** Percentage points, two decimals. */
function difference(actual: string, expected: string): string {
  return formatFixed(add(decimal(actual), negate(decimal(expected))), 2);
}

function maxZero(value: ExactDecimal): ExactDecimal {
  return value.units < 0n ? ZERO : value;
}

function decimal(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}

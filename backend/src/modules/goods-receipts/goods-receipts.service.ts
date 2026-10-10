// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { BusinessRuleError, DomainError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import { formatQuantity, stockValue, sumValues } from '../../core/quantity/domain/stock-value';
import {
  inspect,
  inspectionInputProblem,
  type Condition,
  type Finding,
} from '../../core/receiving/domain/inspection';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { segregationProblem } from '../../core/security/domain/segregation-of-duties';
import { SequenceService } from '../../core/sequence/sequence.service';
import { labelRequestDocument, labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { AuditService } from '../audit/audit.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import {
  LedgerService,
  PostingRefusedError,
  type LockedDocument,
  type NewLot,
  type PostingPlan,
} from '../ledger/ledger.service';
import { LocationsService, type LocationFacts } from '../locations/locations.service';
import {
  PurchaseOrdersService,
  type ReceivableLine,
  type ReceivableOrder,
} from '../purchase-orders/purchase-orders.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import {
  acceptedPieces,
  acceptedQuantity,
  lineComplete,
  lineProblem,
  lotExpiry,
  needsApproval,
  orderStatusAfterReceipt,
  outstandingQuantity,
  RECEIVABLE_ORDER_STATUSES,
  receiptRefusal,
  stepAllowed,
  withinReceivableLimit,
  type CheckedLine,
  type GoodsReceiptStatus,
  type LineProblem,
  type ReceiptRefusal,
  type Step,
} from './domain/goods-receipt-rules';
import type {
  CreateGoodsReceiptDto,
  GoodsReceiptLineDto,
  GoodsReceiptLineView,
  GoodsReceiptPreview,
  GoodsReceiptsQueryDto,
  GoodsReceiptStepDto,
  GoodsReceiptSummary,
  GoodsReceiptView,
  ItemRef,
  LocationRef,
  RejectGoodsReceiptDto,
  SteppedGoodsReceiptView,
  SupplierRef,
  SupplierReturnsQueryDto,
  SupplierReturnView,
  UpdateGoodsReceiptDto,
} from './dto/goods-receipts.dto';

type Tx = Prisma.TransactionClient;

/** One receipt line as stored. Quantities are exact decimal strings. */
interface StoredLine {
  lineNo: number;
  purchaseOrderLineNo: number;
  itemId: string;
  unitCode: string;
  factor: string;
  countedQuantity: string;
  rejectedQuantity: string;
  countedBaseQuantity: string;
  rejectedBaseQuantity: string;
  countedPieces: string | null;
  rejectedPieces: string | null;
  temperature: string | null;
  condition: Condition;
  supplierExpiry: string | null;
  reason: string | null;
  /** Fixed at submission; null on a draft. */
  expectedBaseQuantity: string | null;
  findings: Finding[] | null;
}

/** A line judged against its order line and item, as of now or as submitted. */
interface JudgedLine {
  line: StoredLine;
  orderLine: ReceivableLine;
  item: ItemFacts;
  expected: string;
  findings: Finding[];
  accepted: string;
  acceptedPieces: string | null;
  expiry: ReturnType<typeof lotExpiry>;
  temperatureRequired: boolean;
  withinLimit: boolean;
}

const STEP_ERRORS: Record<Step, string> = {
  edit: 'Only a draft can be edited: this receipt has already been submitted',
  submit: 'Only a draft can be submitted',
  approve: 'Only a submitted receipt can be approved',
  reject: 'Only a submitted receipt, or an approved one not yet posted, can be rejected',
  post: 'Only an approved receipt can be posted',
};

const LINE_ERRORS: Record<LineProblem, string> = {
  COUNTED_NOT_A_NUMBER: 'the counted quantity must be a number',
  COUNTED_NOT_POSITIVE: 'the counted quantity must be more than zero',
  COUNTED_TOO_PRECISE: 'the counted quantity has more decimals than its unit allows',
  COUNTED_TOO_LARGE: 'the counted quantity is too large',
  REJECTED_NOT_A_NUMBER: 'the rejected quantity must be a number',
  REJECTED_NEGATIVE: 'the rejected quantity cannot be below zero',
  REJECTED_TOO_PRECISE: 'the rejected quantity has more decimals than its unit allows',
  REJECTED_MORE_THAN_COUNTED: 'more cannot be rejected than was counted',
  PIECES_REQUIRED: 'a variable-weight item records its piece count, counted and rejected',
  PIECES_NOT_ALLOWED: 'a piece count is recorded only for variable-weight items',
  PIECES_NOT_A_WHOLE_NUMBER: 'a piece count is a whole number',
  PIECES_NOT_POSITIVE:
    'the counted pieces must be more than zero, and rejected pieces not below zero',
  REJECTED_PIECES_MORE_THAN_COUNTED: 'more pieces cannot be rejected than were counted',
  PIECES_DO_NOT_MATCH_QUANTITY:
    'pieces follow weight: whatever weight is accepted or rejected has pieces, and no pieces without weight',
  TEMPERATURE_NOT_A_NUMBER: 'the temperature must be a number',
  TEMPERATURE_OUT_OF_RANGE: 'the temperature is between -60 and 60 °C',
  TEMPERATURE_TOO_PRECISE: 'the temperature has at most one decimal',
  CONDITION_UNKNOWN: 'the condition is good or damaged',
  SUPPLIER_EXPIRY_INVALID: "the supplier's expiry is not a real date",
  REASON_TOO_LONG: 'the reason is at most 500 characters',
};

const PERSON = { select: { id: true, displayName: true } } as const;

/**
 * Goods receipts and returns to supplier (#11; ADR-0007, ADR-0014, ADR-0025). The plant records
 * what arrived against an approved or sent purchase order, line by line, inspected with the one
 * inspection model. A receipt with no findings posts when it is submitted. One with a finding
 * waits for a purchasing approver, never its creator (ADR-0008), whose approval posts it. Posting
 * creates one lot per accepted line at the order line's cost (ADR-0004) with the earlier of the
 * two expiries (ADR-0014), records what arrived on the order, and turns rejected quantity into a
 * return to supplier, which writes nothing to the ledger. All of it in the ledger's one
 * transaction, with the order locked, so two receipts against one order line can never together
 * exceed it.
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly sequences: SequenceService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
    private readonly suppliers: SuppliersService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
  ) {}

  // --- reading ---------------------------------------------------------------------

  async list(query: GoodsReceiptsQueryDto): Promise<GoodsReceiptSummary[]> {
    const rows = await this.prisma.goodsReceipt.findMany({
      where: query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {},
      include: { lines: true },
    });
    const documents = await this.ledger.documents(rows.map((r) => r.documentId));
    const views = await Promise.all(
      rows
        .filter(
          (row) => query.status === 'all' || documents.get(row.documentId)!.status === query.status,
        )
        .map((row) => this.get(row.documentId, false)),
    );
    return views.map((view) => summaryOf(view)).sort((a, b) => b.number.localeCompare(a.number));
  }

  async get(id: string, label = true): Promise<GoodsReceiptView> {
    const row = await this.prisma.goodsReceipt.findUnique({
      where: { documentId: id },
      include: {
        lines: { orderBy: { lineNo: 'asc' } },
        submittedBy: PERSON,
        approvedBy: PERSON,
        rejectedBy: PERSON,
        supplierReturn: { select: { id: true, number: true } },
      },
    });
    if (!row) throw new NotFoundError('Goods receipt', id);
    const [document, order] = await Promise.all([
      this.ledger.document(id),
      this.purchaseOrders.receivable(row.purchaseOrderId),
    ]);
    const lines = row.lines.map(storedLine);
    const [items, locations, suppliers, units, lots] = await Promise.all([
      this.items.describe(lines.map((l) => l.itemId)),
      this.locations.describe([row.locationId]),
      this.suppliers.describe([order!.supplierId]),
      this.unitCatalogue(),
      document.status === 'posted' ? this.ledger.lotsOf(id) : Promise.resolve([]),
    ]);
    const location = locations.get(row.locationId)!;
    if (label) {
      labelRequestDocument(document.number);
      labelRequestLocation(location.code);
    }
    const judged = lines.map((line) =>
      this.judge(line, order!, items, document.businessDate, line.findings ? 'stored' : 'live'),
    );
    const lotByLine = new Map(lots.map((lot) => [lot.lineNo, lot]));
    const views = judged.map((j) => lineView(j, units, lotByLine.get(j.line.lineNo) ?? null));
    return {
      ...document,
      purchaseOrder: { id: order!.id, number: order!.number, status: order!.status },
      supplier: supplierRef(suppliers.get(order!.supplierId)!),
      location: locationRef(location),
      submitted: row.submittedBy ? { by: row.submittedBy, at: row.submittedAt! } : null,
      approved: row.approvedBy ? { by: row.approvedBy, at: row.approvedAt! } : null,
      rejected: row.rejectedBy
        ? { by: row.rejectedBy, at: row.rejectedAt!, reason: row.rejectionReason! }
        : null,
      needsApproval: needsApproval(judged),
      lines: views,
      totalValue: sumValues(views.map((v) => v.value)),
      supplierReturn: row.supplierReturn,
    };
  }

  /**
   * The lines as they would be saved, with their findings, expiry and value, saving nothing: the
   * dock screen shows findings as the receiver types.
   */
  async preview(dto: CreateGoodsReceiptDto): Promise<GoodsReceiptPreview> {
    const order = await this.receivableOrder(dto.purchaseOrderId);
    const businessDate = dto.businessDate ?? this.ledger.today();
    const { lines, items } = await this.validLines(order, dto.lines);
    const units = await this.unitCatalogue();
    const judged = lines.map((line) => this.judge(line, order, items, businessDate, 'live'));
    const views = judged.map((j) => lineView(j, units, null));
    return {
      lines: views,
      needsApproval: needsApproval(judged),
      totalValue: sumValues(views.map((v) => v.value)),
    };
  }

  async returns(query: SupplierReturnsQueryDto): Promise<SupplierReturnView[]> {
    const rows = await this.prisma.supplierReturn.findMany({
      where: query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {},
      select: { id: true },
      orderBy: { number: 'desc' },
    });
    return Promise.all(rows.map((row) => this.supplierReturn(row.id)));
  }

  async supplierReturn(id: string): Promise<SupplierReturnView> {
    const row = await this.prisma.supplierReturn.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { lineNo: 'asc' } },
        createdBy: PERSON,
        goodsReceipt: { select: { documentId: true, document: { select: { number: true } } } },
        purchaseOrder: { select: { id: true, number: true } },
      },
    });
    if (!row) throw new NotFoundError('Return to supplier', id);
    labelRequestDocument(row.number);
    const [items, suppliers] = await Promise.all([
      this.items.describe(row.lines.map((l) => l.itemId)),
      this.suppliers.describe([row.supplierId]),
    ]);
    return {
      id: row.id,
      number: row.number,
      goodsReceipt: { id: row.goodsReceipt.documentId, number: row.goodsReceipt.document.number },
      purchaseOrder: row.purchaseOrder,
      supplier: supplierRef(suppliers.get(row.supplierId)!),
      businessDate: row.businessDate.toISOString().slice(0, 10),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      lines: row.lines.map((line) => {
        const item = items.get(line.itemId)!;
        return {
          lineNo: line.lineNo,
          receiptLineNo: line.receiptLineNo,
          item: itemRef(item),
          quantity: formatQuantity(line.quantity.toFixed(), item.baseUnitDecimals),
          secondaryQuantity: line.secondaryQuantity?.toFixed() ?? null,
          reason: line.reason,
        };
      }),
    };
  }

  // --- drafting --------------------------------------------------------------------

  async create(
    dto: CreateGoodsReceiptDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<GoodsReceiptView> {
    const order = await this.receivableOrder(dto.purchaseOrderId);
    const location = (await this.locations.describe([order.deliveryLocationId])).get(
      order.deliveryLocationId,
    )!;
    labelRequestLocation(location.code);
    const { lines } = await this.validLines(order, dto.lines);
    const id = await this.prisma.$transaction(async (tx) => {
      const document = await this.ledger.createDraft(
        tx,
        'goods_receipt',
        { businessDate: dto.businessDate ?? this.ledger.today(), note: dto.note ?? null },
        actor,
      );
      labelRequestDocument(document.number);
      await tx.goodsReceipt.create({
        data: {
          documentId: document.id,
          purchaseOrderId: order.id,
          locationId: order.deliveryLocationId,
        },
      });
      await this.writeLines(tx, document.id, lines);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'GoodsReceipt',
        entityId: document.id,
        summary: `Drafted goods receipt ${document.number} against purchase order ${order.number}`,
        changes: { status: { from: null, to: 'draft' }, lineCount: lines.length },
        ...meta,
      });
      return document.id;
    });
    return this.get(id);
  }

  /** Changes a draft. Lines, when given, replace them all and are checked again. */
  async update(
    id: string,
    dto: UpdateGoodsReceiptDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<GoodsReceiptView> {
    const { purchaseOrderId } = await this.existing(id);
    const lines = dto.lines
      ? (await this.validLines(await this.receivableOrder(purchaseOrderId), dto.lines)).lines
      : undefined;
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      assertStep(doc, 'edit');
      await this.ledger.updateDraft(tx, doc, {
        ...(dto.businessDate !== undefined ? { businessDate: dto.businessDate } : {}),
        ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
      });
      if (lines) {
        await tx.goodsReceiptLine.deleteMany({ where: { documentId: id } });
        await this.writeLines(tx, id, lines);
      }
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'GoodsReceipt',
        entityId: id,
        summary: `Edited draft goods receipt ${doc.number}`,
        changes: {
          fields: Object.keys(dto).filter((key) => key !== 'revision'),
          ...(lines ? { lineCount: lines.length } : {}),
        },
        ...meta,
      });
    });
    return this.get(id);
  }

  // --- steps -----------------------------------------------------------------------

  /**
   * Submits a draft, inspected as it stands. With no finding it posts here and now. With a
   * finding, its findings and what each order line still expected are fixed on the lines, and it
   * waits for a purchasing approver. Refused, counted and logged like a posting, when it could not
   * post as it stands.
   */
  async submit(
    id: string,
    dto: GoodsReceiptStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<SteppedGoodsReceiptView> {
    await this.existing(id);
    let number = '';
    let clean = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const doc = await this.ledger.lockAt(tx, id, dto.revision);
        number = doc.number;
        assertStep(doc, 'submit');
        const { refusal, judged } = await this.check(tx, doc, 'live', false);
        if (refusal) throw refusalError(refusal);
        clean = !needsApproval(judged);
        if (clean) return; // posted below, in the ledger's own transaction
        await this.fixInspection(tx, id, judged);
        await this.ledger.moveTo(tx, doc, 'submitted');
        await tx.goodsReceipt.update({
          where: { documentId: id },
          data: { submittedById: actor.userId, submittedAt: new Date() },
        });
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.UPDATE,
          entityType: 'GoodsReceipt',
          entityId: id,
          summary: `Submitted goods receipt ${doc.number} for approval: ${findingSummary(judged)}`,
          changes: { status: { from: 'draft', to: 'submitted' }, findings: findingCodes(judged) },
          ...meta,
        });
      });
    } catch (error) {
      if (error instanceof PostingRefusedError) {
        this.ledger.recordTypeRefusal('goods_receipt', number, error);
      }
      throw error;
    }
    if (!clean) {
      this.logger.write({
        severity: 'INFO',
        event: 'app.log',
        message: `Submitted ${number} for approval: outside tolerance`,
        labels: { document_number: number },
      });
      return { ...(await this.get(id)), postingRefusal: null };
    }
    await this.ledger.post(
      id,
      dto.revision,
      actor,
      (tx, doc) => this.plan(tx, doc, 'clean', actor, meta),
      { from: 'draft' },
    );
    return { ...(await this.get(id)), postingRefusal: null };
  }

  /**
   * Approves a submitted receipt's findings and posts it. Nobody approves a receipt they created,
   * whatever roles they hold (ADR-0008): refused here, counted and logged like any refusal, and
   * refused again by the database. When the ledger then refuses the posting (another receipt took
   * the order line to its limit first, say), the receipt stays approved and the answer says why.
   */
  async approve(
    id: string,
    dto: GoodsReceiptStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<SteppedGoodsReceiptView> {
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
        await tx.goodsReceipt.update({
          where: { documentId: id },
          data: { approvedById: actor.userId, approvedAt: new Date() },
        });
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.APPROVE,
          entityType: 'GoodsReceipt',
          entityId: id,
          summary: `Approved goods receipt ${doc.number} with its findings`,
          changes: { status: { from: doc.status, to: 'approved' } },
          ...meta,
        });
        revision = doc.revision + 1;
      });
    } catch (error) {
      if (error instanceof PostingRefusedError) {
        this.ledger.recordTypeRefusal('goods_receipt', number, error);
      }
      throw error;
    }
    this.logger.write({
      severity: 'INFO',
      event: 'document.approved',
      message: `Approved ${number}`,
      labels: { document_number: number },
    });
    return this.postApproved(id, revision, actor, meta);
  }

  /** Posts an approved receipt the ledger refused before; refused again if still so. */
  async post(
    id: string,
    dto: GoodsReceiptStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<GoodsReceiptView> {
    await this.existing(id);
    await this.ledger.post(
      id,
      dto.revision,
      actor,
      (tx, doc) => this.plan(tx, doc, 'approved', actor, meta),
      { from: 'approved' },
    );
    return this.get(id);
  }

  /**
   * Turns down a submitted receipt, or an approved one the ledger refused to post, with a reason
   * for the receiver. Rejected is final: nothing enters stock, nothing is recorded on the order,
   * and a corrected receipt is a new one.
   */
  async reject(
    id: string,
    dto: RejectGoodsReceiptDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<GoodsReceiptView> {
    await this.existing(id);
    if (dto.reason.length === 0) {
      throw new BusinessRuleError(
        'REJECTION_REASON_MISSING',
        'Say why the receipt is rejected, for the person who received it',
      );
    }
    let number = '';
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      number = doc.number;
      assertStep(doc, 'reject');
      await this.ledger.moveTo(tx, doc, 'rejected');
      await tx.goodsReceipt.update({
        where: { documentId: id },
        data: { rejectedById: actor.userId, rejectedAt: new Date(), rejectionReason: dto.reason },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.REJECT,
        entityType: 'GoodsReceipt',
        entityId: id,
        summary: `Rejected goods receipt ${doc.number}`,
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

  // --- posting ---------------------------------------------------------------------

  private async postApproved(
    id: string,
    revision: number,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<SteppedGoodsReceiptView> {
    let postingRefusal: SteppedGoodsReceiptView['postingRefusal'] = null;
    try {
      await this.ledger.post(
        id,
        revision,
        actor,
        (tx, doc) => this.plan(tx, doc, 'approved', actor, meta),
        { from: 'approved' },
      );
    } catch (error) {
      if (!(error instanceof PostingRefusedError)) throw error;
      postingRefusal = { rule: error.rule, message: error.message, details: error.details ?? {} };
    }
    return { ...(await this.get(id)), postingRefusal };
  }

  /**
   * Run by the ledger inside the posting transaction, with the receipt locked: locks the order,
   * checks the receipt against it as it is now, records what arrived on the order, writes the
   * return to supplier, and hands the ledger the lots to create. A clean receipt is inspected
   * again here; an approved one keeps the findings its approver saw.
   */
  private async plan(
    tx: Tx,
    doc: LockedDocument,
    mode: 'clean' | 'approved',
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PostingPlan> {
    const { refusal, judged, receipt, order } = await this.check(
      tx,
      doc,
      mode === 'clean' ? 'live' : 'stored',
      true,
    );
    if (refusal) return { refusal };
    if (mode === 'clean' && needsApproval(judged)) return { refusal: { rule: 'needs_approval' } };

    if (mode === 'clean') {
      await this.fixInspection(tx, doc.id, judged);
      await tx.goodsReceipt.update({
        where: { documentId: doc.id },
        data: { submittedById: actor.userId, submittedAt: new Date() },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'GoodsReceipt',
        entityId: doc.id,
        summary: `Submitted goods receipt ${doc.number}: within tolerance, posted`,
        changes: { status: { from: 'draft', to: 'posted' } },
        ...meta,
      });
    }

    // What the order line will have received once this posts, and whether that completes it.
    const addedByLine = new Map<number, { accepted: string; returned: string }>();
    for (const j of judged) {
      addedByLine.set(j.orderLine.lineNo, {
        accepted: j.accepted,
        returned: j.line.rejectedBaseQuantity,
      });
    }
    const orderItems = await this.items.describe(
      order.lines.map((l) => l.itemId),
      tx,
    );
    const completion = order.lines.map((line) => {
      const added = addedByLine.get(line.lineNo);
      const received = added
        ? sumValues([line.receivedQuantity, added.accepted])
        : line.receivedQuantity;
      return {
        received,
        complete: lineComplete(
          line.baseQuantity,
          received,
          orderItems.get(line.itemId)!.receivingTolerances.maxVariancePercent,
        ),
      };
    });
    await this.purchaseOrders.recordReceipt(
      tx,
      {
        orderId: order.id,
        receiptNumber: doc.number,
        lines: [...addedByLine].map(([lineNo, added]) => ({ lineNo, ...added })),
        status: orderStatusAfterReceipt(completion),
      },
      actor,
      meta,
    );

    const rejected = judged.filter((j) => positive(j.line.rejectedBaseQuantity));
    if (rejected.length > 0) {
      const number = await this.sequences.next(
        tx,
        'SUPPLIER_RETURN',
        Number(this.ledger.today().slice(0, 4)),
      );
      await tx.supplierReturn.create({
        data: {
          number,
          goodsReceiptId: doc.id,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          businessDate: new Date(`${doc.businessDate}T00:00:00Z`),
          createdById: actor.userId,
          lines: {
            create: rejected.map((j, index) => ({
              lineNo: index + 1,
              receiptLineNo: j.line.lineNo,
              itemId: j.item.id,
              quantity: j.line.rejectedBaseQuantity,
              secondaryQuantity:
                j.line.rejectedPieces !== null && positive(j.line.rejectedPieces)
                  ? j.line.rejectedPieces
                  : null,
              reason: j.line.reason!.trim(),
            })),
          },
        },
      });
      this.logger.write({
        severity: 'INFO',
        event: 'app.log',
        message: `${doc.number} returns ${rejected.length} line(s) to the supplier as ${number}`,
        labels: { document_number: doc.number },
      });
    }

    const newLots: NewLot[] = judged
      .filter((j) => positive(j.accepted))
      .map((j) => ({
        lineNo: j.line.lineNo,
        itemId: j.item.id,
        locationId: receipt.locationId,
        quantity: j.accepted,
        secondaryQuantity: j.acceptedPieces,
        unitCost: j.orderLine.unitCost,
        expiryDate: j.expiry.expiryDate,
        computedExpiryDate: j.expiry.computedExpiry,
        supplierExpiryDate: j.expiry.supplierExpiry,
      }));
    return { newLots };
  }

  /**
   * The receipt as stored, judged against its order and items: live (inspected now) or as fixed
   * at submission. `lockOrder` takes the order's lock first, inside a posting.
   */
  private async check(
    tx: Tx,
    doc: LockedDocument,
    findings: 'live' | 'stored',
    lockOrder: boolean,
  ): Promise<{
    refusal: ReceiptRefusal | null;
    judged: JudgedLine[];
    receipt: { locationId: string };
    order: ReceivableOrder;
  }> {
    const receipt = await tx.goodsReceipt.findUniqueOrThrow({
      where: { documentId: doc.id },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    const order = lockOrder
      ? await this.purchaseOrders.lockForReceiving(tx, receipt.purchaseOrderId)
      : (await this.purchaseOrders.receivable(receipt.purchaseOrderId, tx))!;
    const lines = receipt.lines.map(storedLine);
    const [items, locations] = await Promise.all([
      this.items.describe(
        lines.map((l) => l.itemId),
        tx,
      ),
      this.locations.describe([receipt.locationId], tx),
    ]);
    const location = locations.get(receipt.locationId)!;
    labelRequestLocation(location.code);
    const judged = lines.map((line) =>
      this.judge(
        line,
        order,
        items,
        doc.businessDate,
        line.findings && findings === 'stored' ? 'stored' : 'live',
      ),
    );
    const refusal = receiptRefusal({
      businessDate: doc.businessDate,
      orderStatus: order.status,
      location,
      lines: judged.map(checkedLine),
    });
    return { refusal, judged, receipt: { locationId: receipt.locationId }, order };
  }

  /** One line against its order line and item, inspected now or as fixed at submission. */
  private judge(
    line: StoredLine,
    order: ReceivableOrder,
    items: Map<string, ItemFacts>,
    businessDate: string,
    findings: 'live' | 'stored',
  ): JudgedLine {
    const orderLine = order.lines.find((l) => l.lineNo === line.purchaseOrderLineNo)!;
    const item = items.get(line.itemId)!;
    const decimals = item.baseUnitDecimals;
    const expiry = lotExpiry(businessDate, item.shelfLifeDays, line.supplierExpiry);
    const expected =
      findings === 'stored' && line.expectedBaseQuantity !== null
        ? line.expectedBaseQuantity
        : outstandingQuantity(orderLine.baseQuantity, orderLine.receivedQuantity, decimals);
    const accepted = acceptedQuantity(
      line.countedBaseQuantity,
      line.rejectedBaseQuantity,
      decimals,
    );
    return {
      line,
      orderLine,
      item,
      expected,
      findings:
        findings === 'stored' && line.findings
          ? line.findings
          : inspect({
              expectedQuantity: expected,
              countedQuantity: line.countedBaseQuantity,
              temperature: line.temperature,
              condition: line.condition,
              tolerances: item.receivingTolerances,
              computedExpiry: expiry.computedExpiry,
              supplierExpiry: line.supplierExpiry,
            }),
      accepted,
      acceptedPieces: acceptedPieces(line.countedPieces, line.rejectedPieces),
      expiry,
      temperatureRequired:
        inspectionInputProblem({
          temperature: line.temperature,
          tolerances: item.receivingTolerances,
        }) !== null,
      withinLimit: withinReceivableLimit({
        ordered: orderLine.baseQuantity,
        alreadyAccepted: orderLine.receivedQuantity,
        accepting: accepted,
        maxVariancePercent: item.receivingTolerances.maxVariancePercent,
      }),
    };
  }

  /** Fixes each line's findings and expected quantity, while the receipt is still a draft. */
  private async fixInspection(tx: Tx, documentId: string, judged: JudgedLine[]): Promise<void> {
    for (const j of judged) {
      await tx.goodsReceiptLine.update({
        where: { documentId_lineNo: { documentId, lineNo: j.line.lineNo } },
        data: {
          expectedBaseQuantity: j.expected,
          findings: j.findings as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  // --- internals -------------------------------------------------------------------

  /** The order, refused unless goods can be received against it today. */
  private async receivableOrder(id: string): Promise<ReceivableOrder> {
    const order = await this.purchaseOrders.receivable(id);
    if (!order) {
      throw new BusinessRuleError('UNKNOWN_PURCHASE_ORDER', `There is no purchase order '${id}'`);
    }
    if (!RECEIVABLE_ORDER_STATUSES.includes(order.status)) {
      throw new BusinessRuleError(
        'PURCHASE_ORDER_NOT_RECEIVABLE',
        `Goods are received only against an approved or sent purchase order that is not yet fully received: ${order.number} is ${order.status}`,
        { status: order.status },
      );
    }
    return order;
  }

  /** The receipt's order, refusing an unknown receipt early and labelling the request. */
  private async existing(id: string): Promise<{ purchaseOrderId: string }> {
    const found = await this.prisma.goodsReceipt.findUnique({
      where: { documentId: id },
      select: { purchaseOrderId: true, locationId: true, document: { select: { number: true } } },
    });
    if (!found) throw new NotFoundError('Goods receipt', id);
    labelRequestDocument(found.document.number);
    const location = (await this.locations.describe([found.locationId])).get(found.locationId);
    if (location) labelRequestLocation(location.code);
    return { purchaseOrderId: found.purchaseOrderId };
  }

  /**
   * Each line checked against its order line and item; the first problem is refused, naming its
   * line. An order line is received at most once per receipt. Quantities are converted to the base
   * unit once, here, with #5's conversion (ADR-0005, ADR-0019).
   */
  private async validLines(
    order: ReceivableOrder,
    dtos: GoodsReceiptLineDto[],
  ): Promise<{ lines: StoredLine[]; items: Map<string, ItemFacts> }> {
    const [items, units] = await Promise.all([
      this.items.describe(order.lines.map((l) => l.itemId)),
      this.unitCatalogue(),
    ]);
    const seen = new Set<number>();
    const lines = dtos.map((dto, index) => {
      const lineNo = index + 1;
      const orderLine = order.lines.find((l) => l.lineNo === dto.purchaseOrderLineNo);
      if (!orderLine) {
        throw new BusinessRuleError(
          'UNKNOWN_ORDER_LINE',
          `Purchase order ${order.number} has no line ${dto.purchaseOrderLineNo}`,
          { lineNo, purchaseOrderLineNo: dto.purchaseOrderLineNo },
        );
      }
      if (seen.has(orderLine.lineNo)) {
        throw new BusinessRuleError(
          'DUPLICATE_ORDER_LINE',
          `Order line ${orderLine.lineNo} is on more than one line; put everything that arrived for it on one line`,
          { lineNo, purchaseOrderLineNo: orderLine.lineNo },
        );
      }
      seen.add(orderLine.lineNo);
      const item = items.get(orderLine.itemId)!;
      if (!item.active) {
        throw new BusinessRuleError('ITEM_INACTIVE', `${item.code} is no longer in use`, {
          lineNo,
        });
      }
      const counting =
        dto.unitCode === orderLine.unitCode
          ? { factor: orderLine.factor, decimals: units.get(orderLine.unitCode)!.decimals }
          : dto.unitCode === item.baseUnitCode
            ? { factor: '1', decimals: item.baseUnitDecimals }
            : null;
      if (!counting) {
        throw new BusinessRuleError(
          'NOT_A_RECEIVING_UNIT',
          `${item.code} is received in ${orderLine.unitCode}, as ordered, or in ${item.baseUnitCode}`,
          { lineNo, unitCode: dto.unitCode },
        );
      }
      const input = {
        countedQuantity: dto.countedQuantity,
        rejectedQuantity: dto.rejectedQuantity ?? '0',
        countedPieces: dto.countedPieces ?? null,
        rejectedPieces:
          dto.rejectedPieces ??
          (dto.countedPieces !== undefined && dto.countedPieces !== null ? '0' : null),
        temperature: dto.temperature ?? null,
        condition: dto.condition,
        supplierExpiry: dto.supplierExpiry ?? null,
        reason: dto.reason ?? null,
      };
      const problem = lineProblem(input, counting, item);
      if (problem) {
        throw new BusinessRuleError(
          'INVALID_GOODS_RECEIPT_LINE',
          `Line ${lineNo} (${item.code}) is not valid: ${LINE_ERRORS[problem]}`,
          { lineNo, problem },
        );
      }
      const toBase = (quantity: string) =>
        this.items.toBaseQuantity({
          quantity,
          purchaseUnitDecimals: counting.decimals,
          factor: counting.factor,
          baseUnitDecimals: item.baseUnitDecimals,
        });
      return {
        lineNo,
        purchaseOrderLineNo: orderLine.lineNo,
        itemId: item.id,
        unitCode: dto.unitCode,
        factor: counting.factor,
        countedQuantity: input.countedQuantity,
        rejectedQuantity: input.rejectedQuantity,
        countedBaseQuantity: toBase(input.countedQuantity),
        rejectedBaseQuantity: toBase(input.rejectedQuantity),
        countedPieces: input.countedPieces,
        rejectedPieces: input.rejectedPieces,
        temperature: input.temperature,
        condition: input.condition as Condition,
        supplierExpiry: input.supplierExpiry,
        reason: input.reason,
        expectedBaseQuantity: null,
        findings: null,
      };
    });
    return { lines, items };
  }

  private async writeLines(tx: Tx, documentId: string, lines: StoredLine[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.goodsReceiptLine.createMany({
      data: lines.map((line) => ({
        documentId,
        lineNo: line.lineNo,
        purchaseOrderLineNo: line.purchaseOrderLineNo,
        itemId: line.itemId,
        unitCode: line.unitCode,
        factor: line.factor,
        countedQuantity: line.countedQuantity,
        rejectedQuantity: line.rejectedQuantity,
        countedBaseQuantity: line.countedBaseQuantity,
        rejectedBaseQuantity: line.rejectedBaseQuantity,
        countedPieces: line.countedPieces,
        rejectedPieces: line.rejectedPieces,
        temperature: line.temperature,
        condition: line.condition,
        supplierExpiryDate: line.supplierExpiry
          ? new Date(`${line.supplierExpiry}T00:00:00Z`)
          : null,
        reason: line.reason,
      })),
    });
  }

  private async unitCatalogue(): Promise<
    Map<string, { code: string; nameTh: string; nameEn: string; decimals: number }>
  > {
    return new Map((await this.items.units()).map((u) => [u.code, u]));
  }
}

function assertStep(doc: LockedDocument, step: Step): void {
  if (!stepAllowed(doc.status as GoodsReceiptStatus, step)) {
    throw new DomainError('STEP_NOT_ALLOWED', STEP_ERRORS[step], HttpStatus.CONFLICT, {
      status: doc.status,
      step,
    });
  }
}

function refusalError(refusal: ReceiptRefusal): PostingRefusedError {
  return new PostingRefusedError(
    refusal.rule,
    'lineNo' in refusal ? { lineNo: refusal.lineNo } : {},
  );
}

function checkedLine(j: JudgedLine): CheckedLine {
  return {
    lineNo: j.line.lineNo,
    item: j.item,
    temperatureRequired: j.temperatureRequired,
    findings: j.findings,
    rejectedQuantity: j.line.rejectedBaseQuantity,
    acceptedQuantity: j.accepted,
    reason: j.line.reason,
    expiryDate: j.expiry.expiryDate,
    withinReceivableLimit: j.withinLimit,
  };
}

function findingCodes(judged: JudgedLine[]): Record<number, string[]> {
  return Object.fromEntries(
    judged
      .filter((j) => j.findings.length > 0)
      .map((j) => [j.line.lineNo, j.findings.map((f) => f.code)]),
  );
}

function findingSummary(judged: JudgedLine[]): string {
  return judged
    .filter((j) => j.findings.length > 0)
    .map((j) => `line ${j.line.lineNo} ${j.findings.map((f) => f.code).join(', ')}`)
    .join('; ');
}

function storedLine(row: {
  lineNo: number;
  purchaseOrderLineNo: number;
  itemId: string;
  unitCode: string;
  factor: Prisma.Decimal;
  countedQuantity: Prisma.Decimal;
  rejectedQuantity: Prisma.Decimal;
  countedBaseQuantity: Prisma.Decimal;
  rejectedBaseQuantity: Prisma.Decimal;
  countedPieces: Prisma.Decimal | null;
  rejectedPieces: Prisma.Decimal | null;
  temperature: Prisma.Decimal | null;
  condition: string;
  supplierExpiryDate: Date | null;
  reason: string | null;
  expectedBaseQuantity: Prisma.Decimal | null;
  findings: Prisma.JsonValue | null;
}): StoredLine {
  return {
    lineNo: row.lineNo,
    purchaseOrderLineNo: row.purchaseOrderLineNo,
    itemId: row.itemId,
    unitCode: row.unitCode,
    factor: row.factor.toFixed(),
    countedQuantity: row.countedQuantity.toFixed(),
    rejectedQuantity: row.rejectedQuantity.toFixed(),
    countedBaseQuantity: row.countedBaseQuantity.toFixed(),
    rejectedBaseQuantity: row.rejectedBaseQuantity.toFixed(),
    countedPieces: row.countedPieces?.toFixed() ?? null,
    rejectedPieces: row.rejectedPieces?.toFixed() ?? null,
    temperature: row.temperature?.toFixed() ?? null,
    condition: row.condition as Condition,
    supplierExpiry: row.supplierExpiryDate
      ? row.supplierExpiryDate.toISOString().slice(0, 10)
      : null,
    reason: row.reason,
    expectedBaseQuantity: row.expectedBaseQuantity?.toFixed() ?? null,
    findings: (row.findings as unknown as Finding[] | null) ?? null,
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
  };
}

function lineView(
  j: JudgedLine,
  units: Map<string, { code: string; nameTh: string; nameEn: string; decimals: number }>,
  lot: { id: string; number: string } | null,
): GoodsReceiptLineView {
  const unit = units.get(j.line.unitCode)!;
  const decimals = j.item.baseUnitDecimals;
  return {
    lineNo: j.line.lineNo,
    purchaseOrderLineNo: j.line.purchaseOrderLineNo,
    item: itemRef(j.item),
    unit: { code: unit.code, nameTh: unit.nameTh, nameEn: unit.nameEn },
    factor: formatMinimalText(j.line.factor),
    countedQuantity: formatQuantity(j.line.countedQuantity, unit.decimals),
    rejectedQuantity: formatQuantity(j.line.rejectedQuantity, unit.decimals),
    acceptedQuantity: acceptedQuantity(
      j.line.countedQuantity,
      j.line.rejectedQuantity,
      unit.decimals,
    ),
    countedBaseQuantity: formatQuantity(j.line.countedBaseQuantity, decimals),
    rejectedBaseQuantity: formatQuantity(j.line.rejectedBaseQuantity, decimals),
    acceptedBaseQuantity: j.accepted,
    countedPieces: j.line.countedPieces,
    rejectedPieces: j.line.rejectedPieces,
    acceptedPieces: j.acceptedPieces,
    temperature: j.line.temperature,
    condition: j.line.condition,
    reason: j.line.reason,
    orderedBaseQuantity: j.orderLine.baseQuantity,
    expectedBaseQuantity: formatQuantity(j.expected, decimals),
    findings: j.findings,
    expiry: j.expiry,
    unitCost: j.orderLine.unitCost,
    value: stockValue(j.accepted, j.orderLine.unitCost),
    overReceipt: !j.withinLimit,
    lot: lot ? { id: lot.id, number: lot.number } : null,
  };
}

function formatMinimalText(text: string): string {
  return new Prisma.Decimal(text).toFixed();
}

function positive(text: string): boolean {
  return new Prisma.Decimal(text).gt(0);
}

function summaryOf(view: GoodsReceiptView): GoodsReceiptSummary {
  return {
    id: view.id,
    number: view.number,
    type: view.type,
    status: view.status,
    businessDate: view.businessDate,
    note: view.note,
    revision: view.revision,
    createdBy: view.createdBy,
    createdAt: view.createdAt,
    postedBy: view.postedBy,
    postedAt: view.postedAt,
    reverses: view.reverses,
    reversedBy: view.reversedBy,
    purchaseOrder: view.purchaseOrder,
    supplier: view.supplier,
    location: view.location,
    lineCount: view.lines.length,
    linesWithFindings: view.lines.filter((l) => l.findings.length > 0).length,
    totalValue: view.totalValue,
  };
}

function supplierRef(supplier: { id: string; code: string; name: string }): SupplierRef {
  return { id: supplier.id, code: supplier.code, name: supplier.name };
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

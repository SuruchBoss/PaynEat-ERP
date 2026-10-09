// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { APP_CONFIG } from '../../core/config/config.token';
import type { RootConfig } from '../../core/config/configuration';
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
import { segregationProblem } from '../../core/security/domain/segregation-of-duties';
import { SequenceService } from '../../core/sequence/sequence.service';
import { labelRequestDocument, labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { dateIn } from '../../core/time/domain/business-date';
import { AuditService } from '../audit/audit.service';
import { CompanyService } from '../company/company.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import { LocationsService, type LocationFacts } from '../locations/locations.service';
import { SuppliersService, type SupplierFacts } from '../suppliers/suppliers.service';
import {
  deliveryDateProblem,
  lineProblem,
  lineTotals,
  needsApproval,
  orderTotals,
  RECEIVING_TYPES,
  stepAllowed,
  submissionRefusal,
  type OrderRefusal,
  type PurchaseOrderStatus,
  type Step,
} from './domain/purchase-order-rules';
import type {
  CreatePurchaseOrderDto,
  LocationRef,
  PersonRef,
  PurchaseOrderLineDto,
  PurchaseOrderLineView,
  PurchaseOrderReasonDto,
  PurchaseOrdersQueryDto,
  PurchaseOrderStepDto,
  PurchaseOrderSummary,
  PurchaseOrderView,
  SupplierRef,
  UpdatePurchaseOrderDto,
} from './dto/purchase-orders.dto';

type Tx = Prisma.TransactionClient;

interface StoredLine {
  lineNo: number;
  itemId: string;
  unitCode: string;
  factor: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  vatRecoverable: boolean;
  receivedQuantity: string;
  returnedQuantity: string;
}

/** An order line as a goods receipt needs it (#11): what was ordered, at what cost, and how much has arrived. */
export interface ReceivableLine {
  lineNo: number;
  itemId: string;
  unitCode: string;
  /** Base units in one purchase unit, as the line was saved with. */
  factor: string;
  /** In the purchase unit. */
  quantity: string;
  /** What was ordered, in the item's base unit. */
  baseQuantity: string;
  /** Per base unit, net of recoverable VAT: the cost a received lot takes (ADR-0004, ADR-0024). */
  unitCost: string;
  /** Accepted and returned so far, in the base unit. */
  receivedQuantity: string;
  returnedQuantity: string;
}

/** A purchase order as a goods receipt needs it (#11). */
export interface ReceivableOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  deliveryLocationId: string;
  lines: ReceivableLine[];
}

/** What one posted receipt adds to one order line, in the base unit. */
export interface ReceivedOnLine {
  lineNo: number;
  accepted: string;
  returned: string;
}

interface LockedOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  revision: number;
  createdById: string;
}

const STEP_ERRORS: Record<Step, string> = {
  edit: 'Only a draft can be edited: after submission an order changes only by cancelling it',
  submit: 'Only a draft can be submitted',
  approve: 'Only a submitted order waiting for an approver can be approved',
  reject: 'Only a submitted order waiting for an approver can be rejected',
  send: 'Only an approved order can be marked as sent',
  cancel: 'An order can be cancelled only before anything has been received against it',
};

const REFUSAL_ERRORS: Record<OrderRefusal['rule'], string> = {
  empty_order: 'An order needs at least one line',
  inactive_supplier: 'This supplier is no longer in use',
  inactive_location: 'This location is no longer in use',
  location_not_receiving: 'Supplier goods are delivered to a plant or a warehouse',
  inactive_item: 'An item on this order is no longer in use',
  unit_not_purchase_unit: 'A line is in a unit the item is no longer bought in',
};

const LINE_ERRORS = {
  QUANTITY_NOT_A_NUMBER: 'the quantity must be a number',
  QUANTITY_NOT_POSITIVE: 'the quantity must be more than zero',
  QUANTITY_TOO_PRECISE: 'the quantity has more decimals than its unit allows',
  QUANTITY_TOO_LARGE: 'the quantity is too large',
  PRICE_NOT_A_NUMBER: 'the price must be a number',
  PRICE_NOT_POSITIVE: 'the price must be more than zero',
  PRICE_TOO_PRECISE: 'the price has at most four decimals',
  PRICE_TOO_LARGE: 'the price is too large',
  VAT_RATE_NOT_A_NUMBER: 'the VAT rate must be a number',
  VAT_RATE_OUT_OF_RANGE: 'the VAT rate is between 0 and 100 percent',
  VAT_RATE_TOO_PRECISE: 'the VAT rate has at most two decimals',
} as const;

const PERSON = { select: { id: true, displayName: true } } as const;

const ORDER_INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  createdBy: PERSON,
  submittedBy: PERSON,
  approvedBy: PERSON,
  rejectedBy: PERSON,
  sentBy: PERSON,
  cancelledBy: PERSON,
} satisfies Prisma.PurchaseOrderInclude;

type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * Purchase orders (#10; ADR-0024). A purchasing officer drafts an order to a supplier for a plant
 * or warehouse, in the items' purchase units, and submits it. At or below the company's approval
 * threshold, submitting approves it; above it, it waits for a purchasing approver, who is never
 * the person who created it (ADR-0008). An approved order is marked sent; goods receipts (#11)
 * receive against it. An order commits money, not stock: nothing here writes to the ledger.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
    private readonly suppliers: SuppliersService,
    private readonly company: CompanyService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
    @Inject(APP_CONFIG) private readonly config: RootConfig,
  ) {}

  async list(query: PurchaseOrdersQueryDto): Promise<PurchaseOrderSummary[]> {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        ...(query.status !== 'all' ? { status: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      include: ORDER_INCLUDE,
      orderBy: { number: 'desc' },
    });
    const facts = await this.factsFor(rows);
    return rows.map((row) => {
      const { lines, ...view } = this.view(row, facts, '0.00');
      return {
        id: view.id,
        number: view.number,
        status: view.status,
        revision: view.revision,
        supplier: view.supplier,
        deliveryLocation: view.deliveryLocation,
        expectedDeliveryDate: view.expectedDeliveryDate,
        lineCount: lines.length,
        totals: view.totals,
        createdBy: view.createdBy,
        createdAt: view.createdAt,
      };
    });
  }

  async get(id: string): Promise<PurchaseOrderView> {
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!row) throw new NotFoundError('Purchase order', id);
    labelRequestDocument(row.number);
    const [facts, threshold] = await Promise.all([
      this.factsFor([row]),
      row.approvalThreshold === null
        ? this.company.purchaseApprovalThreshold()
        : Promise.resolve(row.approvalThreshold.toFixed(2)),
    ]);
    const view = this.view(row, facts, threshold);
    labelRequestLocation(view.deliveryLocation.code);
    return view;
  }

  async create(
    dto: CreatePurchaseOrderDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PurchaseOrderView> {
    await this.usableSupplier(dto.supplierId);
    const location = await this.usableLocation(dto.deliveryLocationId);
    labelRequestLocation(location.code);
    this.assertDeliveryDate(dto.expectedDeliveryDate);
    const lines = await this.validLines(dto.lines);
    const id = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.next(tx, 'PURCHASE_ORDER', this.currentYear());
      labelRequestDocument(number);
      const created = await tx.purchaseOrder.create({
        data: {
          number,
          supplierId: dto.supplierId,
          deliveryLocationId: location.id,
          expectedDeliveryDate: new Date(`${dto.expectedDeliveryDate}T00:00:00Z`),
          note: dto.note ?? null,
          createdById: actor.userId,
        },
      });
      await this.writeLines(tx, created.id, lines);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'PurchaseOrder',
        entityId: created.id,
        summary: `Drafted purchase order ${number}`,
        changes: { status: { from: null, to: 'draft' }, lineCount: lines.length },
        ...meta,
      });
      return created.id;
    });
    return this.get(id);
  }

  /** Changes a draft. Lines, when given, replace them all and are checked again. */
  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PurchaseOrderView> {
    await this.existing(id);
    if (dto.supplierId) await this.usableSupplier(dto.supplierId);
    const location = dto.deliveryLocationId
      ? await this.usableLocation(dto.deliveryLocationId)
      : undefined;
    if (dto.expectedDeliveryDate) this.assertDeliveryDate(dto.expectedDeliveryDate);
    const lines = dto.lines ? await this.validLines(dto.lines) : undefined;
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockAt(tx, id, dto.revision);
      assertStep(order, 'edit');
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.supplierId ? { supplierId: dto.supplierId } : {}),
          ...(location ? { deliveryLocationId: location.id } : {}),
          ...(dto.expectedDeliveryDate
            ? { expectedDeliveryDate: new Date(`${dto.expectedDeliveryDate}T00:00:00Z`) }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
          revision: { increment: 1 },
        },
      });
      if (lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await this.writeLines(tx, id, lines);
      }
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'PurchaseOrder',
        entityId: id,
        summary: `Edited draft purchase order ${order.number}`,
        changes: {
          fields: Object.keys(dto).filter((key) => key !== 'revision'),
          ...(lines ? { lineCount: lines.length } : {}),
        },
        ...meta,
      });
    });
    return this.get(id);
  }

  /**
   * Submits a draft, checked again as it stands today. Its gross total is judged against the
   * approval threshold in force, which is recorded on the order: at or below it the order is
   * approved here, with no approver; above it, it waits for a purchasing approver.
   */
  async submit(
    id: string,
    dto: PurchaseOrderStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PurchaseOrderView> {
    await this.existing(id);
    let approvedAutomatically = false;
    let number = '';
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockAt(tx, id, dto.revision);
      number = order.number;
      assertStep(order, 'submit');
      const row = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      const lines = row.lines.map(storedLine);
      this.assertDeliveryDate(isoDate(row.expectedDeliveryDate));
      const [supplier, location, items, units] = await Promise.all([
        this.suppliers.describe([row.supplierId], tx),
        this.locations.describe([row.deliveryLocationId], tx),
        this.items.describe(
          lines.map((l) => l.itemId),
          tx,
        ),
        this.items.purchaseUnits(
          lines.map((l) => l.itemId),
          tx,
        ),
      ]);
      const refusal = submissionRefusal({
        supplier: supplier.get(row.supplierId)!,
        location: location.get(row.deliveryLocationId)!,
        lines: lines.map((line) => ({
          lineNo: line.lineNo,
          item: items.get(line.itemId)!,
          unitIsPurchaseUnit: (units.get(line.itemId) ?? []).some(
            (u) => u.unitCode === line.unitCode && u.factor === normaliseDecimal(line.factor),
          ),
        })),
      });
      if (refusal) {
        throw new BusinessRuleError(
          'PURCHASE_ORDER_REFUSED',
          REFUSAL_ERRORS[refusal.rule],
          'lineNo' in refusal ? { rule: refusal.rule, lineNo: refusal.lineNo } : refusal,
        );
      }

      const totals = this.totalsOf(lines, items);
      const threshold = await this.company.purchaseApprovalThreshold(tx);
      approvedAutomatically = !needsApproval(totals.gross, threshold);
      const now = new Date();
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: approvedAutomatically ? 'approved' : 'submitted',
          submittedById: actor.userId,
          submittedAt: now,
          approvalThreshold: threshold,
          ...(approvedAutomatically ? { approvedAutomatically: true, approvedAt: now } : {}),
          revision: { increment: 1 },
        },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: approvedAutomatically ? AuditAction.APPROVE : AuditAction.UPDATE,
        entityType: 'PurchaseOrder',
        entityId: id,
        summary: approvedAutomatically
          ? `Submitted purchase order ${number}; approved automatically: gross ${totals.gross} is within the threshold of ${threshold}`
          : `Submitted purchase order ${number} for approval: gross ${totals.gross} is above the threshold of ${threshold}`,
        changes: {
          status: { from: 'draft', to: approvedAutomatically ? 'approved' : 'submitted' },
          gross: totals.gross,
          approvalThreshold: threshold,
        },
        ...meta,
      });
    });
    if (approvedAutomatically) {
      this.logger.write({
        severity: 'INFO',
        event: 'document.approved',
        message: `Approved ${number} automatically: within the approval threshold`,
        labels: { document_number: number },
      });
    }
    return this.get(id);
  }

  /**
   * Approves a submitted order. Nobody approves an order they created, whatever roles they hold
   * (ADR-0008): refused here, and refused again by the database.
   */
  async approve(
    id: string,
    dto: PurchaseOrderStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PurchaseOrderView> {
    await this.existing(id);
    let number = '';
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockAt(tx, id, dto.revision);
      number = order.number;
      assertStep(order, 'approve');
      const problem = segregationProblem(order, actor.userId);
      if (problem) {
        throw new BusinessRuleError(
          'PURCHASE_ORDER_REFUSED',
          'You created this purchase order, so you cannot approve it: someone else has to (ADR-0008)',
          { rule: problem },
        );
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'approved',
          approvedById: actor.userId,
          approvedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.APPROVE,
        entityType: 'PurchaseOrder',
        entityId: id,
        summary: `Approved purchase order ${number}`,
        changes: { status: { from: order.status, to: 'approved' } },
        ...meta,
      });
    });
    this.logger.write({
      severity: 'INFO',
      event: 'document.approved',
      message: `Approved ${number}`,
      labels: { document_number: number },
    });
    return this.get(id);
  }

  /** Turns down a submitted order, with a reason. Rejected is final: a corrected order is a new one. */
  async reject(
    id: string,
    dto: PurchaseOrderReasonDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PurchaseOrderView> {
    await this.existing(id);
    assertReason(dto.reason, 'REJECTION_REASON_MISSING', 'Say why the order is rejected');
    let number = '';
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockAt(tx, id, dto.revision);
      number = order.number;
      assertStep(order, 'reject');
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectedById: actor.userId,
          rejectedAt: new Date(),
          rejectionReason: dto.reason,
          revision: { increment: 1 },
        },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.REJECT,
        entityType: 'PurchaseOrder',
        entityId: id,
        summary: `Rejected purchase order ${number}`,
        changes: { status: { from: order.status, to: 'rejected' }, reason: dto.reason },
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

  /** Records that an approved order has gone to the supplier. */
  async send(
    id: string,
    dto: PurchaseOrderStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PurchaseOrderView> {
    await this.existing(id);
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockAt(tx, id, dto.revision);
      assertStep(order, 'send');
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'sent',
          sentById: actor.userId,
          sentAt: new Date(),
          revision: { increment: 1 },
        },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'PurchaseOrder',
        entityId: id,
        summary: `Sent purchase order ${order.number} to the supplier`,
        changes: { status: { from: order.status, to: 'sent' } },
        ...meta,
      });
    });
    return this.get(id);
  }

  /** Cancels an order before anything has been received against it, with a reason. Final. */
  async cancel(
    id: string,
    dto: PurchaseOrderReasonDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PurchaseOrderView> {
    await this.existing(id);
    assertReason(dto.reason, 'CANCELLATION_REASON_MISSING', 'Say why the order is cancelled');
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockAt(tx, id, dto.revision);
      assertStep(order, 'cancel');
      await tx.purchaseOrder.update({
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
        entityType: 'PurchaseOrder',
        entityId: id,
        summary: `Cancelled purchase order ${order.number}`,
        changes: { status: { from: order.status, to: 'cancelled' }, reason: dto.reason },
        ...meta,
      });
    });
    return this.get(id);
  }

  // --- receiving (#11) ---------------------------------------------------------------

  /**
   * The order as a goods receipt needs it, or null when there is none. Pass the caller's
   * transaction to read inside it.
   */
  async receivable(id: string, tx: Tx = this.prisma): Promise<ReceivableOrder | null> {
    const row = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!row) return null;
    const lines = row.lines.map(storedLine);
    const items = await this.items.describe(
      lines.map((l) => l.itemId),
      tx,
    );
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      supplierId: row.supplierId,
      deliveryLocationId: row.deliveryLocationId,
      lines: lines.map((line) => {
        const totals = lineTotals(priced(line, items.get(line.itemId)!));
        return {
          lineNo: line.lineNo,
          itemId: line.itemId,
          unitCode: line.unitCode,
          factor: normaliseDecimal(line.factor),
          quantity: normaliseDecimal(line.quantity),
          baseQuantity: totals.baseQuantity,
          unitCost: totals.unitCost,
          receivedQuantity: line.receivedQuantity,
          returnedQuantity: line.returnedQuantity,
        };
      }),
    };
  }

  /**
   * Locks the order for the rest of the caller's transaction and reads it as a goods receipt
   * needs it. A receipt posting takes this lock after its own document's, so two receipts posted
   * at once against the same order queue up here, and the second sees what the first received.
   */
  async lockForReceiving(tx: Tx, id: string): Promise<ReceivableOrder> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "purchase_orders" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Purchase order', id);
    return (await this.receivable(id, tx))!;
  }

  /**
   * Records what a posted goods receipt accepted and returned against the order's lines, and moves
   * the order to partially received or received when anything was accepted, inside the receipt's posting transaction with the
   * order locked by `lockForReceiving`. Audited against the order.
   */
  async recordReceipt(
    tx: Tx,
    input: {
      orderId: string;
      receiptNumber: string;
      lines: ReceivedOnLine[];
      /** Null leaves the order's status as it is: nothing was accepted on it yet. */
      status: 'partially_received' | 'received' | null;
    },
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<void> {
    const before = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      select: { number: true, status: true },
    });
    for (const line of input.lines) {
      await tx.$executeRaw`
        UPDATE "purchase_order_lines"
        SET "received_quantity" = "received_quantity" + ${line.accepted}::numeric,
            "returned_quantity" = "returned_quantity" + ${line.returned}::numeric
        WHERE "purchase_order_id" = ${input.orderId}::uuid AND "line_no" = ${line.lineNo}
      `;
    }
    await tx.purchaseOrder.update({
      where: { id: input.orderId },
      data: { ...(input.status ? { status: input.status } : {}), revision: { increment: 1 } },
    });
    await this.audit.recordWithin(tx, {
      actorUserId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'PurchaseOrder',
      entityId: input.orderId,
      summary: `Received ${input.receiptNumber} against purchase order ${before.number}`,
      changes: {
        status: { from: before.status, to: input.status ?? before.status },
        receipt: input.receiptNumber,
        lines: input.lines,
      },
      ...meta,
    });
  }

  // --- internals -------------------------------------------------------------------

  /** Today in the company's time zone (ADR-0018). */
  private today(): string {
    return dateIn(this.config.app.timeZone, new Date());
  }

  private currentYear(): number {
    return Number(this.today().slice(0, 4));
  }

  /** The order, locked, at the revision the person acted on; labels the request with its number. */
  private async lockAt(tx: Tx, id: string, revision: number): Promise<LockedOrder> {
    const rows = await tx.$queryRaw<LockedOrder[]>`
      SELECT "id", "number", "status"::text AS "status", "revision", "created_by_id" AS "createdById"
        FROM "purchase_orders" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const order = rows[0];
    if (!order) throw new NotFoundError('Purchase order', id);
    labelRequestDocument(order.number);
    if (order.revision !== revision) {
      throw new ConflictError(
        'PURCHASE_ORDER_CHANGED',
        'This purchase order was changed by someone else since you opened it. Reload it and try again.',
        { currentRevision: order.revision },
      );
    }
    return order;
  }

  /** Refuses an unknown order early, and labels the request with its number and location. */
  private async existing(id: string): Promise<void> {
    const found = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: { number: true, deliveryLocationId: true },
    });
    if (!found) throw new NotFoundError('Purchase order', id);
    labelRequestDocument(found.number);
    const location = (await this.locations.describe([found.deliveryLocationId])).get(
      found.deliveryLocationId,
    );
    if (location) labelRequestLocation(location.code);
  }

  private assertDeliveryDate(date: string): void {
    const problem = deliveryDateProblem(date, this.today());
    if (problem === 'DELIVERY_DATE_INVALID') {
      throw new BusinessRuleError('DELIVERY_DATE_INVALID', `${date} is not a date`);
    }
    if (problem === 'DELIVERY_DATE_PAST') {
      throw new BusinessRuleError(
        'DELIVERY_DATE_PAST',
        'The expected delivery date is today or later',
        { expectedDeliveryDate: date, today: this.today() },
      );
    }
  }

  private async usableSupplier(id: string): Promise<SupplierFacts> {
    const supplier = (await this.suppliers.describe([id])).get(id);
    if (!supplier) throw new BusinessRuleError('UNKNOWN_SUPPLIER', `There is no supplier '${id}'`);
    if (!supplier.active) {
      throw new BusinessRuleError('SUPPLIER_INACTIVE', REFUSAL_ERRORS.inactive_supplier);
    }
    return supplier;
  }

  private async usableLocation(id: string): Promise<LocationFacts> {
    const location = (await this.locations.describe([id])).get(id);
    if (!location) throw new BusinessRuleError('UNKNOWN_LOCATION', `There is no location '${id}'`);
    if (!RECEIVING_TYPES.includes(location.type)) {
      throw new BusinessRuleError('LOCATION_NOT_RECEIVING', REFUSAL_ERRORS.location_not_receiving);
    }
    if (!location.active) {
      throw new BusinessRuleError('LOCATION_INACTIVE', REFUSAL_ERRORS.inactive_location);
    }
    return location;
  }

  /**
   * Each line checked against its item and the units it is bought in today; the first problem is
   * refused, naming its line. The conversion factor is copied onto the line.
   */
  private async validLines(lines: PurchaseOrderLineDto[]): Promise<StoredLine[]> {
    const itemIds = lines.map((l) => l.itemId);
    const [items, units] = await Promise.all([
      this.items.describe(itemIds),
      this.items.purchaseUnits(itemIds),
    ]);
    return lines.map((dto, index) => {
      const lineNo = index + 1;
      const item = items.get(dto.itemId);
      if (!item) {
        throw new BusinessRuleError('UNKNOWN_ITEM', `There is no item '${dto.itemId}'`, {
          lineNo,
        });
      }
      if (!item.active) {
        throw new BusinessRuleError('ITEM_INACTIVE', `${item.code} is no longer in use`, {
          lineNo,
        });
      }
      const unit = (units.get(item.id) ?? []).find((u) => u.unitCode === dto.unitCode);
      if (!unit) {
        throw new BusinessRuleError(
          'NOT_A_PURCHASE_UNIT',
          `${item.code} is not bought in '${dto.unitCode}'`,
          { lineNo, unitCode: dto.unitCode },
        );
      }
      const problem = lineProblem(dto, unit);
      if (problem) {
        throw new BusinessRuleError(
          'INVALID_PURCHASE_ORDER_LINE',
          `Line ${lineNo} (${item.code}) is not valid: ${LINE_ERRORS[problem]}`,
          { lineNo, problem },
        );
      }
      return {
        lineNo,
        itemId: item.id,
        unitCode: unit.unitCode,
        factor: unit.factor,
        quantity: normaliseDecimal(dto.quantity),
        unitPrice: normaliseDecimal(dto.unitPrice),
        vatRate: normaliseDecimal(dto.vatRate),
        vatRecoverable: dto.vatRecoverable,
        receivedQuantity: '0.000',
        returnedQuantity: '0.000',
      };
    });
  }

  private async writeLines(tx: Tx, purchaseOrderId: string, lines: StoredLine[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.purchaseOrderLine.createMany({
      // What has been received starts at zero: only goods receipts write it (#11).
      data: lines.map((line) => ({
        purchaseOrderId,
        lineNo: line.lineNo,
        itemId: line.itemId,
        unitCode: line.unitCode,
        factor: line.factor,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        vatRecoverable: line.vatRecoverable,
      })),
    });
  }

  private totalsOf(lines: StoredLine[], items: Map<string, ItemFacts>) {
    return orderTotals(lines.map((line) => lineTotals(priced(line, items.get(line.itemId)!))));
  }

  /** The suppliers, locations, items and units a set of orders refers to. */
  private async factsFor(rows: OrderRow[]): Promise<{
    suppliers: Map<string, SupplierFacts>;
    locations: Map<string, LocationFacts>;
    items: Map<string, ItemFacts>;
    units: Map<string, { code: string; nameTh: string; nameEn: string }>;
  }> {
    const lines = rows.flatMap((r) => r.lines);
    const [suppliers, locations, items, unitRows] = await Promise.all([
      this.suppliers.describe(rows.map((r) => r.supplierId)),
      this.locations.describe(rows.map((r) => r.deliveryLocationId)),
      this.items.describe(lines.map((l) => l.itemId)),
      this.items.units(),
    ]);
    const units = new Map(unitRows.map((u) => [u.code, u]));
    return { suppliers, locations, items, units };
  }

  private view(
    row: OrderRow,
    facts: Awaited<ReturnType<PurchaseOrdersService['factsFor']>>,
    threshold: string,
  ): PurchaseOrderView {
    const lines = row.lines.map(storedLine);
    const views = lines.map((line) =>
      lineView(line, facts.items.get(line.itemId)!, facts.units.get(line.unitCode)!),
    );
    const totals = orderTotals(views);
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      revision: row.revision,
      supplier: supplierRef(facts.suppliers.get(row.supplierId)!),
      deliveryLocation: locationRef(facts.locations.get(row.deliveryLocationId)!),
      expectedDeliveryDate: isoDate(row.expectedDeliveryDate),
      note: row.note,
      totals,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      submitted:
        row.submittedBy && row.submittedAt && row.approvalThreshold
          ? {
              by: row.submittedBy,
              at: row.submittedAt,
              approvalThreshold: row.approvalThreshold.toFixed(2),
            }
          : null,
      approved: row.approvedAt
        ? {
            by: row.approvedBy as PersonRef | null,
            at: row.approvedAt,
            automatically: row.approvedAutomatically,
          }
        : null,
      rejected:
        row.rejectedBy && row.rejectedAt
          ? { by: row.rejectedBy, at: row.rejectedAt, reason: row.rejectionReason! }
          : null,
      sent: row.sentBy && row.sentAt ? { by: row.sentBy, at: row.sentAt } : null,
      cancelled:
        row.cancelledBy && row.cancelledAt
          ? { by: row.cancelledBy, at: row.cancelledAt, reason: row.cancellationReason! }
          : null,
      approval: { threshold, needsApprover: needsApproval(totals.gross, threshold) },
      lines: views,
    };
  }
}

function assertStep(order: LockedOrder, step: Step): void {
  if (!stepAllowed(order.status, step)) {
    throw new DomainError('STEP_NOT_ALLOWED', STEP_ERRORS[step], HttpStatus.CONFLICT, {
      status: order.status,
      step,
    });
  }
}

function assertReason(reason: string, code: string, message: string): void {
  if (reason.length === 0) throw new BusinessRuleError(code, message);
}

function storedLine(row: {
  lineNo: number;
  itemId: string;
  unitCode: string;
  factor: Prisma.Decimal;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  vatRecoverable: boolean;
  receivedQuantity: Prisma.Decimal;
  returnedQuantity: Prisma.Decimal;
}): StoredLine {
  return {
    lineNo: row.lineNo,
    itemId: row.itemId,
    unitCode: row.unitCode,
    factor: row.factor.toFixed(),
    quantity: row.quantity.toFixed(),
    unitPrice: row.unitPrice.toFixed(),
    vatRate: row.vatRate.toFixed(),
    vatRecoverable: row.vatRecoverable,
    receivedQuantity: row.receivedQuantity.toFixed(3),
    returnedQuantity: row.returnedQuantity.toFixed(3),
  };
}

function priced(line: StoredLine, item: ItemFacts) {
  return { ...line, baseUnitDecimals: item.baseUnitDecimals };
}

function lineView(
  line: StoredLine,
  item: ItemFacts,
  unit: { code: string; nameTh: string; nameEn: string },
): PurchaseOrderLineView {
  return {
    lineNo: line.lineNo,
    item: {
      id: item.id,
      code: item.code,
      nameTh: item.nameTh,
      nameEn: item.nameEn,
      active: item.active,
      baseUnitCode: item.baseUnitCode,
    },
    unit: { code: unit.code, nameTh: unit.nameTh, nameEn: unit.nameEn },
    factor: normaliseDecimal(line.factor),
    quantity: normaliseDecimal(line.quantity),
    unitPrice: normaliseDecimal(line.unitPrice),
    vatRate: normaliseDecimal(line.vatRate),
    vatRecoverable: line.vatRecoverable,
    ...lineTotals(priced(line, item)),
    receivedQuantity: formatQuantityIn(line.receivedQuantity, item.baseUnitDecimals),
    returnedQuantity: formatQuantityIn(line.returnedQuantity, item.baseUnitDecimals),
  };
}

/** A base quantity with exactly the base unit's decimals: "238.400" kg, "8" bags. */
function formatQuantityIn(quantity: string, decimals: number): string {
  return new Prisma.Decimal(quantity).toFixed(decimals);
}

function supplierRef(supplier: SupplierFacts): SupplierRef {
  return { id: supplier.id, code: supplier.code, name: supplier.name, taxId: supplier.taxId };
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

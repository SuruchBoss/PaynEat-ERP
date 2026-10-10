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
import { normaliseDecimal } from '../../core/quantity/domain/stock-value';
import {
  inspect,
  inspectionInputProblem,
  type Condition,
  type Finding,
} from '../../core/receiving/domain/inspection';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { labelRequestDocument, labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { AuditService } from '../audit/audit.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import {
  LedgerService,
  PostingRefusedError,
  type LockedDocument,
  type LotChange,
  type LotFacts,
  type PostingPlan,
} from '../ledger/ledger.service';
import {
  differenceResolved,
  needsApproval,
  reasonRequired,
  receiptLineProblem,
  receiptRefusal,
  receiptStepAllowed,
  unresolved,
  type CheckedReceiptLine,
  type ReceiptLineInput,
  type ReceiptLineProblem,
  type ReceiptRefusal,
  type ReceiptStatus,
  type ReceiptStep,
} from './domain/transfer-rules';
import type {
  CreateTransferReceiptDto,
  ReceiptCheck,
  ReceiptLineDto,
  ReceiptLineView,
  ReceiptStepDto,
  RejectTransferReceiptDto,
  SteppedTransferReceiptView,
  TransferReceiptSummary,
  TransferReceiptView,
  TransferReceiptsQueryDto,
  UpdateTransferReceiptDto,
} from './dto/transfers.dto';
import {
  itemRef,
  locationRef,
  TransfersService,
  type ReceivableTransfer,
} from './transfers.service';

type Tx = Prisma.TransactionClient;

const PERSON = { select: { id: true, displayName: true } } as const;

const RECEIPT_INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  submittedBy: PERSON,
  approvedBy: PERSON,
  rejectedBy: PERSON,
} satisfies Prisma.TransferReceiptInclude;

type ReceiptRow = Prisma.TransferReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>;
type LineRow = ReceiptRow['lines'][number];

const STEP_ERRORS: Record<ReceiptStep, string> = {
  edit: 'Only a draft receipt can be edited: this one has already been submitted',
  submit: 'Only a draft receipt can be submitted',
  approve: 'Only a submitted receipt can be approved',
  reject: 'Only a submitted receipt, or an approved one that could not post, can be rejected',
  post: 'Only an approved receipt is posted this way',
};

const LINE_ERRORS: Record<ReceiptLineProblem, string> = {
  RECEIVED_INVALID: 'what arrived is a number, not below zero, as precise as its unit',
  ACCEPTED_INVALID: 'what is accepted is a number, not below zero, as precise as its unit',
  RETURNED_INVALID: 'what goes back is a number, not below zero, as precise as its unit',
  WRITTEN_OFF_INVALID: 'what is written off is a number, not below zero, as precise as its unit',
  ACCEPTED_MORE_THAN_RECEIVED: 'only what arrived can be accepted',
  RETURNED_MORE_THAN_TURNED_AWAY:
    'only what arrived and was not accepted can go back to the origin; what never arrived is written off',
  PIECES_REQUIRED: 'a variable-weight item records its pieces for every part',
  PIECES_NOT_ALLOWED: 'a piece count is recorded only for variable-weight items',
  PIECES_INVALID: 'a piece count is a whole number, not below zero',
  PIECES_WITHOUT_QUANTITY: 'pieces never come without weight',
  ACCEPTED_WITHOUT_PIECES: 'accepted stock of a variable-weight item has its piece count',
  TEMPERATURE_NOT_A_NUMBER: 'the temperature must be a number',
  TEMPERATURE_OUT_OF_RANGE: 'the temperature is between -60 and 60 °C',
  TEMPERATURE_TOO_PRECISE: 'the temperature has at most one decimal',
  CONDITION_UNKNOWN: 'the condition is good or damaged',
  REASON_TOO_LONG: 'the reason is at most 500 characters',
};

/** One line with everything the rules judge it on. */
interface JudgedLine extends CheckedReceiptLine {
  row: StoredLine;
  item: ItemFacts;
  lot: LotFacts;
  dispatched: { quantity: string; pieces: string | null };
}

/** A line as stored, quantities in their shortest spelling. */
interface StoredLine extends ReceiptLineInput {
  lineNo: number;
  lotId: string;
  itemId: string;
  findings: Finding[] | null;
}

/**
 * Transfer receipts (#14; ADR-0007, ADR-0008, ADR-0028). The destination records, for every lot
 * line that left, what arrived, its temperature and condition, inspected with the one inspection
 * model goods receipts use, and accounts for all of it as accepted into the destination, returned
 * to the origin or written off. A receipt with no finding and nothing written off posts when it
 * is submitted; otherwise someone else holding the plant's approval decides. Several receipts of
 * a transfer may be drafted; posting locks the transfer, so exactly one ever posts, and it moves
 * everything out of transit in the ledger's one transaction.
 */
@Injectable()
export class TransferReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly transfers: TransfersService,
    private readonly items: ItemsService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
  ) {}

  // --- reading ---------------------------------------------------------------------

  async list(query: TransferReceiptsQueryDto): Promise<TransferReceiptSummary[]> {
    const rows = await this.prisma.transferReceipt.findMany({
      where: query.transferId ? { transferId: query.transferId } : {},
      select: {
        documentId: true,
        transferId: true,
        location: {
          select: { id: true, code: true, type: true, nameTh: true, nameEn: true, active: true },
        },
      },
    });
    const documents = await this.ledger.documents([
      ...rows.map((r) => r.documentId),
      ...rows.map((r) => r.transferId),
    ]);
    return rows
      .map((row) => {
        const document = documents.get(row.documentId)!;
        return {
          ...document,
          status: document.status as ReceiptStatus,
          transfer: { id: row.transferId, number: documents.get(row.transferId)!.number },
          location: locationRef(row.location),
        };
      })
      .filter((r) => query.status === 'all' || r.status === query.status)
      .sort((a, b) => b.number.localeCompare(a.number));
  }

  async get(id: string, label = true): Promise<TransferReceiptView> {
    const row = await this.prisma.transferReceipt.findUnique({
      where: { documentId: id },
      include: RECEIPT_INCLUDE,
    });
    if (!row) throw new NotFoundError('Transfer receipt', id);
    const document = await this.ledger.document(id);
    const transfer = await this.transfers.receivable(row.transferId);
    if (label) {
      labelRequestDocument(document.number);
      labelRequestLocation(transfer.destination.code);
    }
    const status = document.status as ReceiptStatus;
    const open = status !== 'posted' && status !== 'rejected';
    const judged = await this.judge(row.lines.map(storedLine), transfer, status === 'draft');
    const refusal = open
      ? receiptRefusal({
          businessDate: document.businessDate,
          transferStatus: transfer.status,
          dispatchDate: transfer.businessDate,
          destinationActive: transfer.destination.active,
          lines: judged,
        })
      : null;

    return {
      ...document,
      status,
      transfer: {
        id: transfer.id,
        number: transfer.number,
        status: transfer.status,
        businessDate: transfer.businessDate,
        origin: locationRef(transfer.origin),
        destination: locationRef(transfer.destination),
      },
      location: locationRef(transfer.destination),
      submitted: row.submittedBy ? { by: row.submittedBy, at: row.submittedAt! } : null,
      approved: row.approvedBy ? { by: row.approvedBy, at: row.approvedAt! } : null,
      rejected: row.rejectedBy
        ? { by: row.rejectedBy, at: row.rejectedAt!, reason: row.rejectionReason! }
        : null,
      lines: judged.map(lineView),
      needsApproval: needsApproval(judged),
      blockers: refusal ? [toCheck(refusal)] : [],
    };
  }

  // --- drafting --------------------------------------------------------------------

  /** Raises a receipt of a dispatched transfer, at its destination, with every lot line once. */
  async create(
    transferId: string,
    dto: CreateTransferReceiptDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferReceiptView> {
    const transfer = await this.transfers.receivable(transferId);
    labelRequestLocation(transfer.destination.code);
    if (transfer.status !== 'dispatched') {
      throw new DomainError(
        'TRANSFER_NOT_RECEIVABLE',
        transfer.status === 'received'
          ? 'This transfer has already been received'
          : transfer.status === 'reversed'
            ? 'This transfer was reversed: its stock went back to the origin'
            : 'Only a dispatched transfer can be received',
        HttpStatus.CONFLICT,
        { status: transfer.status },
      );
    }
    const lines = await this.validLines(transfer, dto.lines);
    const businessDate = dto.businessDate ?? this.ledger.today();
    const id = await this.prisma.$transaction(async (tx) => {
      const document = await this.ledger.createDraft(
        tx,
        'transfer_receipt',
        { businessDate, note: dto.note ?? null },
        actor,
      );
      labelRequestDocument(document.number);
      await tx.transferReceipt.create({
        data: {
          documentId: document.id,
          transferId,
          locationId: transfer.destination.id,
        },
      });
      await tx.transferReceiptLine.createMany({
        data: lines.map((l) => lineData(document.id, l)),
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'TransferReceipt',
        entityId: document.id,
        summary: `Drafted receipt ${document.number} of transfer ${transfer.number} at ${transfer.destination.code}`,
        changes: { status: { from: null, to: 'draft' }, lineCount: lines.length },
        ...meta,
      });
      return document.id;
    });
    return this.get(id);
  }

  async update(
    id: string,
    dto: UpdateTransferReceiptDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferReceiptView> {
    const { transferId } = await this.existing(id);
    const transfer = await this.transfers.receivable(transferId);
    const lines = dto.lines ? await this.validLines(transfer, dto.lines) : null;
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockAt(tx, id, dto.revision);
      assertStep(doc, 'edit');
      await this.ledger.updateDraft(tx, doc, {
        ...(dto.businessDate !== undefined ? { businessDate: dto.businessDate } : {}),
        ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
      });
      if (lines) {
        await tx.transferReceiptLine.deleteMany({ where: { documentId: id } });
        await tx.transferReceiptLine.createMany({ data: lines.map((l) => lineData(id, l)) });
      }
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'TransferReceipt',
        entityId: id,
        summary: `Edited draft receipt ${doc.number}`,
        changes: { fields: Object.keys(dto).filter((key) => key !== 'revision') },
        ...meta,
      });
    });
    return this.get(id);
  }

  // --- steps -----------------------------------------------------------------------

  /**
   * Submits a draft, inspected as it stands. With no finding and nothing written off it posts here
   * and now. Otherwise its findings are fixed on the lines and it waits for someone else holding
   * the plant's approval. Refused, counted and logged like a posting, when it could not go
   * forward as it stands.
   */
  async submit(
    id: string,
    dto: ReceiptStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<SteppedTransferReceiptView> {
    await this.existing(id);
    let number = '';
    let clean = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const doc = await this.ledger.lockAt(tx, id, dto.revision);
        number = doc.number;
        assertStep(doc, 'submit');
        const { refusal, judged } = await this.check(tx, doc, 'live', false);
        if (refusal) throw new PostingRefusedError(refusal.rule, refusalDetails(refusal));
        clean = !needsApproval(judged);
        if (clean) return; // posted below, in the ledger's own transaction
        await this.fixInspection(tx, id, judged);
        await this.ledger.moveTo(tx, doc, 'submitted');
        await tx.transferReceipt.update({
          where: { documentId: id },
          data: { submittedById: actor.userId, submittedAt: new Date() },
        });
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.UPDATE,
          entityType: 'TransferReceipt',
          entityId: id,
          summary: `Submitted receipt ${doc.number} for approval`,
          changes: {
            status: { from: 'draft', to: 'submitted' },
            findings: judged.flatMap((j) => j.findings.map((f) => f.code)),
            writtenOff: judged.filter((j) => sign(exact(j.writtenOff)) > 0).map((j) => j.lineNo),
          },
          ...meta,
        });
      });
    } catch (error) {
      if (error instanceof PostingRefusedError) {
        this.ledger.recordTypeRefusal('transfer_receipt', number, error);
      }
      throw error;
    }
    if (!clean) {
      this.logger.write({
        severity: 'INFO',
        event: 'app.log',
        message: `Submitted ${number} for approval: a finding or a write-off`,
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
   * Approves a submitted receipt's findings and write-offs and posts it. Nobody approves a receipt
   * they created or submitted (ADR-0008), whatever roles they hold: refused here, counted and
   * logged, and refused again by the database. Nor is a receipt of a transfer whose dispatch was
   * reversed approved. When the ledger then refuses the posting (another receipt of the transfer
   * posted first, say), the receipt stays approved and the answer says why.
   */
  async approve(
    id: string,
    dto: ReceiptStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<SteppedTransferReceiptView> {
    await this.existing(id);
    let number = '';
    let revision = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        const doc = await this.ledger.lockAt(tx, id, dto.revision);
        number = doc.number;
        assertStep(doc, 'approve');
        const receipt = await tx.transferReceipt.findUniqueOrThrow({
          where: { documentId: id },
          select: { transferId: true, submittedById: true },
        });
        if (doc.createdById === actor.userId || receipt.submittedById === actor.userId) {
          throw new PostingRefusedError('self_approval');
        }
        const transfer = await this.transfers.receivable(receipt.transferId, tx);
        if (transfer.status === 'reversed') throw new PostingRefusedError('transfer_reversed');
        await this.ledger.moveTo(tx, doc, 'approved');
        await tx.transferReceipt.update({
          where: { documentId: id },
          data: { approvedById: actor.userId, approvedAt: new Date() },
        });
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.APPROVE,
          entityType: 'TransferReceipt',
          entityId: id,
          summary: `Approved receipt ${doc.number} with its findings and write-offs`,
          changes: { status: { from: doc.status, to: 'approved' } },
          ...meta,
        });
        revision = doc.revision + 1;
      });
    } catch (error) {
      if (error instanceof PostingRefusedError) {
        this.ledger.recordTypeRefusal('transfer_receipt', number, error);
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
    dto: ReceiptStepDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferReceiptView> {
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
   * for the receiver. Rejected is final: nothing moves, and the branch raises a new receipt.
   */
  async reject(
    id: string,
    dto: RejectTransferReceiptDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<TransferReceiptView> {
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
      await tx.transferReceipt.update({
        where: { documentId: id },
        data: { rejectedById: actor.userId, rejectedAt: new Date(), rejectionReason: dto.reason },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.REJECT,
        entityType: 'TransferReceipt',
        entityId: id,
        summary: `Rejected receipt ${doc.number}`,
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
  ): Promise<SteppedTransferReceiptView> {
    let postingRefusal: SteppedTransferReceiptView['postingRefusal'] = null;
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
   * Run by the ledger inside the posting transaction, with the receipt locked: locks the transfer,
   * checks the receipt against it as it is now, marks the transfer received, and hands the ledger
   * every move out of transit: accepted into the destination, returned to the origin, written off.
   * A clean receipt is inspected again here; an approved one keeps the findings its approver saw.
   */
  private async plan(
    tx: Tx,
    doc: LockedDocument,
    mode: 'clean' | 'approved',
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<PostingPlan> {
    const { refusal, judged, transfer } = await this.check(
      tx,
      doc,
      mode === 'clean' ? 'live' : 'stored',
      true,
    );
    if (refusal) {
      return {
        refusal: { rule: refusal.rule, ...('lineNo' in refusal ? { lineNo: refusal.lineNo } : {}) },
      };
    }
    if (mode === 'clean' && needsApproval(judged)) return { refusal: { rule: 'needs_approval' } };
    if (!transfer.inTransit)
      throw new Error(`transfer ${transfer.number} has no in-transit location`);

    if (mode === 'clean') {
      await this.fixInspection(tx, doc.id, judged);
      await tx.transferReceipt.update({
        where: { documentId: doc.id },
        data: { submittedById: actor.userId, submittedAt: new Date() },
      });
    }
    await this.transfers.markReceived(tx, transfer.id, doc.id);

    const lotChanges: LotChange[] = judged.flatMap((line) => {
      const base = { lineNo: line.lineNo, lotId: line.lot.id, itemId: line.item.id };
      const parts: Array<[string, string | null, string | null]> = [
        [line.accepted, line.row.acceptedPieces, transfer.destination.id],
        [line.returned, line.row.returnedPieces, transfer.origin.id],
        [line.writtenOff, line.row.writtenOffPieces, null],
      ];
      return parts.flatMap(([quantity, counted, to]) => {
        if (sign(exact(quantity)) === 0) return [];
        // A ledger entry carries a piece count, or none; never zero pieces (weight lost on the
        // road moves no birds).
        const pieces = counted === null || sign(exact(counted)) === 0 ? null : counted;
        const moves: LotChange[] = [
          {
            ...base,
            locationId: transfer.inTransit!.id,
            quantity: negated(quantity),
            secondaryQuantity: pieces === null ? null : negated(pieces),
          },
        ];
        if (to) moves.push({ ...base, locationId: to, quantity, secondaryQuantity: pieces });
        return moves;
      });
    });
    await this.audit.recordWithin(tx, {
      actorUserId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'TransferReceipt',
      entityId: doc.id,
      summary: `Posted receipt ${doc.number}: transfer ${transfer.number} received at ${transfer.destination.code}`,
      changes: {
        status: { from: mode === 'clean' ? 'draft' : 'approved', to: 'posted' },
        lines: judged.map((j) => ({
          lineNo: j.lineNo,
          accepted: j.accepted,
          returned: j.returned,
          writtenOff: j.writtenOff,
        })),
      },
      ...meta,
    });
    return { lotChanges };
  }

  // --- internals -------------------------------------------------------------------

  /**
   * The receipt judged against its transfer: the inspection live (a draft, or a clean receipt
   * posting) or as fixed on submission (an approved one), and the first rule that refuses it.
   * Inside a posting the transfer is locked first.
   */
  private async check(
    tx: Tx,
    doc: LockedDocument,
    findings: 'live' | 'stored',
    lock: boolean,
  ): Promise<{
    refusal: ReceiptRefusal | null;
    judged: JudgedLine[];
    transfer: ReceivableTransfer;
  }> {
    const row = await tx.transferReceipt.findUniqueOrThrow({
      where: { documentId: doc.id },
      include: RECEIPT_INCLUDE,
    });
    const transfer = lock
      ? await this.transfers.lockForReceipt(tx, row.transferId)
      : await this.transfers.receivable(row.transferId, tx);
    labelRequestLocation(transfer.destination.code);
    const judged = await this.judge(row.lines.map(storedLine), transfer, findings === 'live', tx);
    const refusal = receiptRefusal({
      businessDate: doc.businessDate,
      transferStatus: transfer.status,
      dispatchDate: transfer.businessDate,
      destinationActive: transfer.destination.active,
      lines: judged,
    });
    return { refusal, judged, transfer };
  }

  /** Each line with its item, lot, what was dispatched, and its inspection. */
  private async judge(
    lines: readonly StoredLine[],
    transfer: ReceivableTransfer,
    live: boolean,
    tx: Tx = this.prisma,
  ): Promise<JudgedLine[]> {
    const [items, lots] = await Promise.all([
      this.items.describe(lines.map((l) => l.itemId)),
      this.ledger.lotFacts(
        lines.map((l) => l.lotId),
        tx,
      ),
    ]);
    return lines.map((line) => {
      const item = items.get(line.itemId)!;
      const lot = lots.get(line.lotId)!;
      const pick = transfer.picks.find((p) => p.pickNo === line.lineNo)!;
      const dispatched = { quantity: pick.quantity, pieces: pick.pieces };
      const tolerances = item.receivingTolerances;
      const found =
        live || line.findings === null
          ? inspect({
              expectedQuantity: pick.quantity,
              countedQuantity: line.received,
              temperature: line.temperature,
              condition: line.condition as Condition,
              tolerances,
              // A transfer never changes a lot's expiry (ADR-0014): nothing is short dated here.
              computedExpiry: lot.expiryDate,
              supplierExpiry: null,
            })
          : line.findings;
      return {
        lineNo: line.lineNo,
        row: line,
        item,
        lot,
        dispatched,
        temperatureRequired:
          inspectionInputProblem({ temperature: line.temperature, tolerances }) !== null,
        findings: found,
        resolved: differenceResolved(dispatched, line),
        accepted: line.accepted,
        returned: line.returned,
        writtenOff: line.writtenOff,
        reason: line.reason,
        expiryDate: lot.expiryDate,
      };
    });
  }

  /** Fixes each line's findings, so the approver decides on exactly what was found. */
  private async fixInspection(tx: Tx, id: string, judged: readonly JudgedLine[]): Promise<void> {
    for (const line of judged) {
      await tx.transferReceiptLine.update({
        where: { documentId_lineNo: { documentId: id, lineNo: line.lineNo } },
        data: { findings: line.findings as unknown as Prisma.InputJsonValue },
      });
    }
  }

  /** Every lot line of the transfer exactly once, each valid for its item. */
  private async validLines(
    transfer: ReceivableTransfer,
    lines: readonly ReceiptLineDto[],
  ): Promise<StoredLine[]> {
    const lots = await this.ledger.lotFacts(transfer.picks.map((p) => p.lotId));
    const items = await this.items.describe([...lots.values()].map((l) => l.itemId));
    const seen = new Set<number>();
    const stored = lines.map((line) => {
      const pick = transfer.picks.find((p) => p.pickNo === line.lineNo);
      if (!pick || seen.has(line.lineNo)) {
        throw lineError(line.lineNo, 'is not a lot line of this transfer, or is repeated');
      }
      seen.add(line.lineNo);
      const lot = lots.get(pick.lotId)!;
      const item = items.get(lot.itemId)!;
      const input: ReceiptLineInput = {
        received: line.received,
        receivedPieces: line.receivedPieces ?? null,
        temperature: line.temperature ?? null,
        condition: line.condition,
        accepted: line.accepted,
        acceptedPieces: line.acceptedPieces ?? null,
        returned: line.returned,
        returnedPieces: line.returnedPieces ?? null,
        writtenOff: line.writtenOff,
        writtenOffPieces: line.writtenOffPieces ?? null,
        reason: line.reason ?? null,
      };
      const problem = receiptLineProblem(input, {
        decimals: item.baseUnitDecimals,
        variableWeight: item.variableWeight,
      });
      if (problem) throw lineError(line.lineNo, `${lot.number}: ${LINE_ERRORS[problem]}`);
      return {
        lineNo: line.lineNo,
        lotId: lot.id,
        itemId: item.id,
        ...normalised(input),
        findings: null,
      };
    });
    const missing = transfer.picks.filter((p) => !seen.has(p.pickNo));
    if (missing.length > 0) {
      throw new BusinessRuleError(
        'RECEIPT_LINES_MISSING',
        `Record every lot that left: lot lines ${missing.map((p) => p.pickNo).join(', ')} are missing`,
        { missing: missing.map((p) => p.pickNo) },
      );
    }
    return stored.sort((a, b) => a.lineNo - b.lineNo);
  }

  private async existing(id: string): Promise<{ number: string; transferId: string }> {
    const row = await this.prisma.transferReceipt.findUnique({
      where: { documentId: id },
      select: {
        transferId: true,
        location: { select: { code: true } },
        document: { select: { number: true } },
      },
    });
    if (!row) throw new NotFoundError('Transfer receipt', id);
    labelRequestDocument(row.document.number);
    labelRequestLocation(row.location.code);
    return { number: row.document.number, transferId: row.transferId };
  }
}

function storedLine(row: LineRow): StoredLine {
  return {
    lineNo: row.lineNo,
    lotId: row.lotId,
    itemId: row.itemId,
    received: normaliseDecimal(row.received.toFixed()),
    receivedPieces: row.receivedPieces?.toFixed() ?? null,
    temperature: row.temperature ? normaliseDecimal(row.temperature.toFixed()) : null,
    condition: row.condition,
    accepted: normaliseDecimal(row.accepted.toFixed()),
    acceptedPieces: row.acceptedPieces?.toFixed() ?? null,
    returned: normaliseDecimal(row.returned.toFixed()),
    returnedPieces: row.returnedPieces?.toFixed() ?? null,
    writtenOff: normaliseDecimal(row.writtenOff.toFixed()),
    writtenOffPieces: row.writtenOffPieces?.toFixed() ?? null,
    reason: row.reason,
    findings: (row.findings as unknown as Finding[] | null) ?? null,
  };
}

function normalised(line: ReceiptLineInput): ReceiptLineInput {
  const pieces = (p: string | null) => (p === null ? null : normaliseDecimal(p));
  return {
    received: normaliseDecimal(line.received),
    receivedPieces: pieces(line.receivedPieces),
    temperature: line.temperature === null ? null : normaliseDecimal(line.temperature),
    condition: line.condition,
    accepted: normaliseDecimal(line.accepted),
    acceptedPieces: pieces(line.acceptedPieces),
    returned: normaliseDecimal(line.returned),
    returnedPieces: pieces(line.returnedPieces),
    writtenOff: normaliseDecimal(line.writtenOff),
    writtenOffPieces: pieces(line.writtenOffPieces),
    reason: line.reason,
  };
}

function lineData(documentId: string, line: StoredLine): Prisma.TransferReceiptLineCreateManyInput {
  return {
    documentId,
    lineNo: line.lineNo,
    lotId: line.lotId,
    itemId: line.itemId,
    received: line.received,
    receivedPieces: line.receivedPieces,
    temperature: line.temperature,
    condition: line.condition as Condition,
    accepted: line.accepted,
    acceptedPieces: line.acceptedPieces,
    returned: line.returned,
    returnedPieces: line.returnedPieces,
    writtenOff: line.writtenOff,
    writtenOffPieces: line.writtenOffPieces,
    reason: line.reason,
  };
}

function lineView(line: JudgedLine): ReceiptLineView {
  return {
    lineNo: line.lineNo,
    item: itemRef(line.item),
    lot: {
      id: line.lot.id,
      number: line.lot.number,
      expiryDate: line.lot.expiryDate,
      unitCost: line.lot.unitCost,
    },
    dispatched: line.dispatched.quantity,
    dispatchedPieces: line.dispatched.pieces,
    received: line.row.received,
    receivedPieces: line.row.receivedPieces,
    temperature: line.row.temperature,
    condition: line.row.condition,
    accepted: line.row.accepted,
    acceptedPieces: line.row.acceptedPieces,
    returned: line.row.returned,
    returnedPieces: line.row.returnedPieces,
    writtenOff: line.row.writtenOff,
    writtenOffPieces: line.row.writtenOffPieces,
    reason: line.row.reason,
    findings: [...line.findings],
    reasonRequired: reasonRequired(line.findings, line.row),
    unresolved: unresolved(line.dispatched.quantity, line.row),
    tolerances: line.item.receivingTolerances,
  };
}

function toCheck(refusal: ReceiptRefusal): ReceiptCheck {
  return 'lineNo' in refusal
    ? { rule: refusal.rule, lineNo: refusal.lineNo }
    : { rule: refusal.rule };
}

function refusalDetails(refusal: ReceiptRefusal): Record<string, unknown> {
  return 'lineNo' in refusal ? { lineNo: refusal.lineNo } : {};
}

function assertStep(doc: LockedDocument, step: ReceiptStep): void {
  if (!receiptStepAllowed(doc.status as ReceiptStatus, step)) {
    throw new DomainError('STEP_NOT_ALLOWED', STEP_ERRORS[step], HttpStatus.CONFLICT, {
      status: doc.status,
      step,
    });
  }
}

function lineError(lineNo: number, problem: string): BusinessRuleError {
  return new BusinessRuleError('INVALID_RECEIPT_LINE', `Lot line ${lineNo}: ${problem}`, {
    lineNo,
  });
}

function negated(text: string): string {
  return formatMinimal(negate(exact(text)));
}

function exact(text: string): ExactDecimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`not a decimal: "${text}"`);
  return value;
}

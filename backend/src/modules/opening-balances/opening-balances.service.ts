// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BusinessRuleError, NotFoundError } from '../../core/errors/domain.errors';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  formatQuantity,
  normaliseDecimal,
  stockValue,
  sumValues,
} from '../../core/quantity/domain/stock-value';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { labelRequestLocation } from '../../core/telemetry/request-context';
import { ItemsService, type ItemFacts } from '../items/items.service';
import { LedgerService, type PostingPlan } from '../ledger/ledger.service';
import { LocationsService, type LocationFacts } from '../locations/locations.service';
import { lineProblem, locationProblem, postingRefusal } from './domain/opening-balance-rules';
import type {
  CreateOpeningBalanceDto,
  LocationRef,
  OpeningBalanceLineDto,
  OpeningBalanceLineView,
  OpeningBalancesQueryDto,
  OpeningBalanceSummary,
  OpeningBalanceView,
  PostOpeningBalanceDto,
  ReverseOpeningBalanceDto,
  UpdateOpeningBalanceDto,
} from './dto/opening-balances.dto';

type Tx = Prisma.TransactionClient;

interface StoredLine {
  lineNo: number;
  itemId: string;
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
}

const LOCATION_ERRORS = {
  LOCATION_SYSTEM_MANAGED:
    'An opening balance is kept at a plant, warehouse or branch, never in transit',
  LOCATION_INACTIVE: 'This location is no longer in use',
} as const;

/**
 * Opening balances (#7; docs/GLOSSARY.md "Opening balance"): the stock that already exists at a
 * plant, warehouse or branch when it starts using the ERP. A draft is edited freely and affects
 * nothing. Posting — done by the ledger, in one transaction — turns every line into a lot with
 * the cost and expiry entered on it. A mistake is corrected by a reversal, never an edit.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
  ) {}

  async list(query: OpeningBalancesQueryDto): Promise<OpeningBalanceSummary[]> {
    const rows = await this.prisma.openingBalance.findMany({
      where: query.locationId ? { locationId: query.locationId } : {},
      include: { lines: { select: { quantity: true, unitCost: true } } },
    });
    const [documents, locations] = await Promise.all([
      this.ledger.documents(rows.map((r) => r.documentId)),
      this.locations.describe(rows.map((r) => r.locationId)),
    ]);
    return rows
      .map((row) => ({
        ...documents.get(row.documentId)!,
        location: locationRef(locations.get(row.locationId)!),
        lineCount: row.lines.length,
        totalValue: sumValues(
          row.lines.map((l) => stockValue(l.quantity.toFixed(), l.unitCost.toFixed())),
        ),
      }))
      .filter((summary) => query.status === 'all' || summary.status === query.status)
      .sort((a, b) => b.number.localeCompare(a.number));
  }

  async get(id: string): Promise<OpeningBalanceView> {
    const row = await this.prisma.openingBalance.findUnique({
      where: { documentId: id },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!row) throw new NotFoundError('Opening balance', id);
    const lines = row.lines.map(storedLine);
    const [document, lots, items, locations] = await Promise.all([
      this.ledger.document(id),
      this.ledger.lotsOf(id),
      this.items.describe(lines.map((l) => l.itemId)),
      this.locations.describe([row.locationId]),
    ]);
    const location = locations.get(row.locationId)!;
    labelRequestLocation(location.code);
    const lotByLine = new Map(lots.map((lot) => [lot.lineNo, lot]));
    const views = lines.map((line) =>
      lineView(line, items.get(line.itemId)!, lotByLine.get(line.lineNo)),
    );
    return {
      ...document,
      location: locationRef(location),
      lines: views,
      totalValue: sumValues(views.map((v) => v.value)),
    };
  }

  async create(
    dto: CreateOpeningBalanceDto,
    actor: AuthenticatedUser,
  ): Promise<OpeningBalanceView> {
    const location = await this.usableLocation(dto.locationId);
    labelRequestLocation(location.code);
    const lines = await this.validLines(dto.lines);
    const id = await this.prisma.$transaction(async (tx) => {
      const document = await this.ledger.createDraft(
        tx,
        'opening_balance',
        { businessDate: dto.businessDate ?? this.ledger.today(), note: dto.note ?? null },
        actor,
      );
      await tx.openingBalance.create({
        data: { documentId: document.id, locationId: location.id },
      });
      await this.writeLines(tx, document.id, lines);
      return document.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateOpeningBalanceDto): Promise<OpeningBalanceView> {
    await this.existing(id);
    const location = dto.locationId ? await this.usableLocation(dto.locationId) : undefined;
    const lines = dto.lines ? await this.validLines(dto.lines) : undefined;
    await this.prisma.$transaction(async (tx) => {
      const doc = await this.ledger.lockDraft(tx, id, dto.revision);
      await this.ledger.updateDraft(tx, doc, {
        ...(dto.businessDate !== undefined ? { businessDate: dto.businessDate } : {}),
        ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
      });
      if (location) {
        await tx.openingBalance.update({
          where: { documentId: id },
          data: { locationId: location.id },
        });
      }
      if (lines) {
        await tx.openingBalanceLine.deleteMany({ where: { documentId: id } });
        await this.writeLines(tx, id, lines);
      }
    });
    return this.get(id);
  }

  /** Posts the draft at the revision the person reviewed; the ledger writes it all or nothing. */
  async post(
    id: string,
    dto: PostOpeningBalanceDto,
    actor: AuthenticatedUser,
  ): Promise<OpeningBalanceView> {
    await this.existing(id);
    await this.ledger.post(id, dto.revision, actor, (tx, doc) => this.plan(tx, doc));
    return this.get(id);
  }

  /** Reverses a posted opening balance exactly; both stay visible. */
  async reverse(
    id: string,
    dto: ReverseOpeningBalanceDto,
    actor: AuthenticatedUser,
  ): Promise<OpeningBalanceView> {
    await this.existing(id);
    await this.ledger.reverse(
      id,
      { businessDate: dto.businessDate, note: dto.note ?? null },
      actor,
    );
    return this.get(id);
  }

  /** Run by the ledger inside the posting transaction, with the document locked. */
  private async plan(tx: Tx, doc: { id: string; businessDate: string }): Promise<PostingPlan> {
    const row = await tx.openingBalance.findUniqueOrThrow({
      where: { documentId: doc.id },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    const lines = row.lines.map(storedLine);
    const [locations, items] = await Promise.all([
      this.locations.describe([row.locationId], tx),
      this.items.describe(
        lines.map((l) => l.itemId),
        tx,
      ),
    ]);
    const location = locations.get(row.locationId)!;
    labelRequestLocation(location.code);

    const refusal = postingRefusal(
      {
        businessDate: doc.businessDate,
        location,
        lines: lines.map((line) => ({ ...line, item: items.get(line.itemId)! })),
      },
      this.ledger.today(),
    );
    if (refusal) return { refusal };
    return {
      newLots: lines.map((line) => ({ ...line, locationId: location.id })),
    };
  }

  private async existing(id: string): Promise<void> {
    const found = await this.prisma.openingBalance.findUnique({
      where: { documentId: id },
      select: { documentId: true, locationId: true },
    });
    if (!found) throw new NotFoundError('Opening balance', id);
    const location = (await this.locations.describe([found.locationId])).get(found.locationId);
    if (location) labelRequestLocation(location.code);
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

  /** Each line checked against its item; the first problem is refused, naming its line. */
  private async validLines(lines: OpeningBalanceLineDto[]): Promise<StoredLine[]> {
    const items = await this.items.describe(lines.map((l) => l.itemId));
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
      const line = {
        quantity: dto.quantity,
        secondaryQuantity: dto.secondaryQuantity ?? null,
        unitCost: dto.unitCost,
        expiryDate: dto.expiryDate,
      };
      const problem = lineProblem(line, item);
      if (problem) {
        throw new BusinessRuleError(
          'INVALID_OPENING_BALANCE_LINE',
          `Line ${lineNo} (${item.code}) is not valid: ${problem}`,
          { lineNo, problem },
        );
      }
      return { lineNo, itemId: item.id, ...line };
    });
  }

  private async writeLines(tx: Tx, documentId: string, lines: StoredLine[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.openingBalanceLine.createMany({
      data: lines.map((line) => ({
        documentId,
        lineNo: line.lineNo,
        itemId: line.itemId,
        quantity: line.quantity,
        secondaryQuantity: line.secondaryQuantity,
        unitCost: line.unitCost,
        expiryDate: new Date(`${line.expiryDate}T00:00:00.000Z`),
      })),
    });
  }
}

function storedLine(row: {
  lineNo: number;
  itemId: string;
  quantity: Prisma.Decimal;
  secondaryQuantity: Prisma.Decimal | null;
  unitCost: Prisma.Decimal;
  expiryDate: Date;
}): StoredLine {
  return {
    lineNo: row.lineNo,
    itemId: row.itemId,
    quantity: row.quantity.toFixed(),
    secondaryQuantity: row.secondaryQuantity?.toFixed() ?? null,
    unitCost: normaliseDecimal(row.unitCost.toFixed()),
    expiryDate: row.expiryDate.toISOString().slice(0, 10),
  };
}

function lineView(
  line: StoredLine,
  item: ItemFacts,
  lot: { id: string; number: string } | undefined,
): OpeningBalanceLineView {
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
    quantity: formatQuantity(line.quantity, item.baseUnitDecimals),
    secondaryQuantity: line.secondaryQuantity,
    unitCost: line.unitCost,
    expiryDate: line.expiryDate,
    value: stockValue(line.quantity, line.unitCost),
    lot: lot ? { id: lot.id, number: lot.number } : null,
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

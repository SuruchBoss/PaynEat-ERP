// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import { AuditAction, MasterDataAction, Prisma } from '@prisma/client';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { AuditService } from '../audit/audit.service';
import { MasterDataService } from '../master-data/master-data.service';
import { normalisePurchaseUnits, purchaseUnitIssues } from './domain/item-rules';
import { normaliseFactor } from './domain/unit-conversion';
import type {
  CreateItemDto,
  ItemsQueryDto,
  ItemView,
  PurchaseUnitDto,
  UnitView,
  UpdateItemDto,
} from './dto/items.dto';

const ITEM_SELECT = {
  id: true,
  code: true,
  nameTh: true,
  nameEn: true,
  baseUnitCode: true,
  variableWeight: true,
  shelfLifeDays: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  purchaseUnits: { select: { unitCode: true, factor: true }, orderBy: { unitCode: 'asc' } },
} satisfies Prisma.ItemSelect;

type ItemRow = Prisma.ItemGetPayload<{ select: typeof ITEM_SELECT }>;

/** The master data entity type items are logged under. */
export const ITEM_ENTITY = 'item';

/** What another module needs to know about an item to use it on a document (#7). */
export interface ItemFacts {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  active: boolean;
  variableWeight: boolean;
  baseUnitCode: string;
  /** Decimals a quantity in the base unit keeps (ADR-0019). */
  baseUnitDecimals: number;
}

/**
 * The item master (#5, ADR-0005): what the company stocks, in which base unit, bought in
 * which purchase units. Every create and update commits together with its master data
 * change (the version a POS pulls by) and its audit entry, or not at all. Items are
 * deactivated, never deleted; code and base unit never change.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterData: MasterDataService,
    private readonly audit: AuditService,
  ) {}

  async units(): Promise<UnitView[]> {
    return this.prisma.unit.findMany({ orderBy: { code: 'asc' } });
  }

  async list(query: ItemsQueryDto): Promise<ItemView[]> {
    const where: Prisma.ItemWhereInput = {};
    if (query.status !== 'all') where.active = query.status === 'active';
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { nameTh: { contains: query.q, mode: 'insensitive' } },
        { nameEn: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.item.findMany({
      where,
      select: ITEM_SELECT,
      orderBy: { code: 'asc' },
    });
    return rows.map(toView);
  }

  async get(id: string): Promise<ItemView> {
    const row = await this.prisma.item.findUnique({ where: { id }, select: ITEM_SELECT });
    if (!row) throw new NotFoundError('Item', id);
    return toView(row);
  }

  /**
   * The facts other modules need about these items, keyed by id; unknown ids are absent.
   * Pass the caller's transaction to read inside it.
   */
  async describe(
    ids: readonly string[],
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, ItemFacts>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.item.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        code: true,
        nameTh: true,
        nameEn: true,
        active: true,
        variableWeight: true,
        baseUnitCode: true,
        baseUnit: { select: { decimals: true } },
      },
    });
    return new Map(
      rows.map(({ baseUnit, ...row }) => [row.id, { ...row, baseUnitDecimals: baseUnit.decimals }]),
    );
  }

  async create(dto: CreateItemDto, actor: AuthenticatedUser, meta: ClientMeta): Promise<ItemView> {
    const knownUnits = await this.knownUnitCodes();
    if (!knownUnits.has(dto.baseUnitCode)) {
      throw new BusinessRuleError('UNKNOWN_UNIT', `There is no unit "${dto.baseUnitCode}"`, {
        field: 'baseUnitCode',
      });
    }
    const purchaseUnits = this.validPurchaseUnits(dto.baseUnitCode, dto.purchaseUnits, knownUnits);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const version = await this.masterData.nextVersion(tx);
        const item = await tx.item.create({
          data: {
            code: dto.code,
            nameTh: dto.nameTh,
            nameEn: dto.nameEn,
            baseUnitCode: dto.baseUnitCode,
            variableWeight: dto.variableWeight,
            shelfLifeDays: dto.shelfLifeDays,
            version,
            purchaseUnits: { create: purchaseUnits },
          },
          select: ITEM_SELECT,
        });
        await this.recordChange(tx, item, MasterDataAction.created);
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'Item',
          entityId: item.id,
          summary: `Created item ${item.code} (${item.nameEn})`,
          changes: snapshot(item),
          ...meta,
        });
        return item;
      });
      return toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('ITEM_CODE_TAKEN', `An item with code ${dto.code} already exists`);
      }
      throw error;
    }
  }

  /**
   * Changes the given fields. Refused when `dto.version` is not the item's current
   * version: someone else changed it since the editor loaded it. A request that changes
   * nothing records nothing and keeps the version.
   */
  async update(
    id: string,
    dto: UpdateItemDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ItemView> {
    const knownUnits = dto.purchaseUnits ? await this.knownUnitCodes() : new Set<string>();

    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockItem(tx, id);
      if (Number(current.version) !== dto.version) {
        throw new ConflictError(
          'ITEM_CHANGED',
          'This item was changed by someone else since you opened it. Reload it and try again.',
          { currentVersion: Number(current.version) },
        );
      }

      const purchaseUnits = dto.purchaseUnits
        ? this.validPurchaseUnits(current.baseUnitCode, dto.purchaseUnits, knownUnits)
        : undefined;
      const changes = diff(current, { ...dto, purchaseUnits });
      if (Object.keys(changes).length === 0) return current;

      const version = await this.masterData.nextVersion(tx);
      if (purchaseUnits) {
        await tx.itemPurchaseUnit.deleteMany({ where: { itemId: id } });
        await tx.itemPurchaseUnit.createMany({
          data: purchaseUnits.map((p) => ({ itemId: id, ...p })),
        });
      }
      const item = await tx.item.update({
        where: { id },
        data: {
          nameTh: dto.nameTh,
          nameEn: dto.nameEn,
          variableWeight: dto.variableWeight,
          shelfLifeDays: dto.shelfLifeDays,
          active: dto.active,
          version,
        },
        select: ITEM_SELECT,
      });
      await this.recordChange(tx, item, MasterDataAction.updated);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'Item',
        entityId: item.id,
        summary: `${summaryVerb(changes)} item ${item.code} (${item.nameEn})`,
        changes,
        ...meta,
      });
      return item;
    });
    return toView(row);
  }

  private async recordChange(
    tx: Prisma.TransactionClient,
    item: ItemRow,
    action: MasterDataAction,
  ): Promise<void> {
    await this.masterData.append(tx, item.version, {
      entityType: ITEM_ENTITY,
      entityId: item.id,
      entityCode: item.code,
      action,
      data: { ...snapshot(item), version: Number(item.version) },
    });
  }

  private async knownUnitCodes(): Promise<Set<string>> {
    const units = await this.prisma.unit.findMany({ select: { code: true } });
    return new Set(units.map((u) => u.code));
  }

  private validPurchaseUnits(
    baseUnitCode: string,
    purchaseUnits: PurchaseUnitDto[],
    knownUnits: ReadonlySet<string>,
  ): Array<{ unitCode: string; factor: string }> {
    const issues = purchaseUnitIssues(baseUnitCode, purchaseUnits, knownUnits);
    if (issues.length > 0) {
      throw new BusinessRuleError(
        'INVALID_PURCHASE_UNITS',
        `Purchase units: ${issues.map((i) => `${i.unitCode} ${i.problem}`).join(', ')}`,
        { issues },
      );
    }
    return normalisePurchaseUnits(purchaseUnits);
  }

  /** The item, locked for the rest of the transaction so concurrent edits queue up. */
  private async lockItem(tx: Prisma.TransactionClient, id: string): Promise<ItemRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM items WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (locked.length === 0) throw new NotFoundError('Item', id);
    return tx.item.findUniqueOrThrow({ where: { id }, select: ITEM_SELECT });
  }
}

function purchaseUnitsOf(item: ItemRow): Array<{ unitCode: string; factor: string }> {
  return item.purchaseUnits.map((p) => ({
    unitCode: p.unitCode,
    factor: normaliseFactor(p.factor.toFixed()),
  }));
}

function toView(item: ItemRow): ItemView {
  return {
    id: item.id,
    code: item.code,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    baseUnitCode: item.baseUnitCode,
    variableWeight: item.variableWeight,
    shelfLifeDays: item.shelfLifeDays,
    active: item.active,
    purchaseUnits: purchaseUnitsOf(item),
    version: Number(item.version),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * The item as a mirror or an auditor needs it. `code` is spelled `itemCode` because the
 * audit trail redacts any field called `code` (it is also the name of a second-factor
 * code); the change log uses the same shape so the two read alike.
 */
function snapshot(item: ItemRow) {
  return {
    id: item.id,
    itemCode: item.code,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    baseUnitCode: item.baseUnitCode,
    variableWeight: item.variableWeight,
    shelfLifeDays: item.shelfLifeDays,
    active: item.active,
    purchaseUnits: purchaseUnitsOf(item),
  };
}

type Changes = Record<string, { from: unknown; to: unknown }>;

/** The fields `update` really changes, as `{ from, to }`; untouched fields are left out. */
function diff(
  current: ItemRow,
  next: Omit<UpdateItemDto, 'version' | 'purchaseUnits'> & {
    purchaseUnits?: Array<{ unitCode: string; factor: string }>;
  },
): Changes {
  const changes: Changes = {};
  const scalar = ['nameTh', 'nameEn', 'variableWeight', 'shelfLifeDays', 'active'] as const;
  for (const field of scalar) {
    const to = next[field];
    if (to !== undefined && to !== current[field]) changes[field] = { from: current[field], to };
  }
  if (next.purchaseUnits) {
    const from = purchaseUnitsOf(current);
    if (JSON.stringify(from) !== JSON.stringify(next.purchaseUnits)) {
      changes.purchaseUnits = { from, to: next.purchaseUnits };
    }
  }
  return changes;
}

function summaryVerb(changes: Changes): string {
  if (Object.keys(changes).length === 1 && changes.active) {
    return changes.active.to ? 'Reactivated' : 'Deactivated';
  }
  return 'Updated';
}

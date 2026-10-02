// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import { AuditAction, MasterDataAction, MenuSoldBy, Prisma } from '@prisma/client';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { compareDates, isIsoDate } from '../../core/time/domain/business-date';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { LocationsService } from '../locations/locations.service';
import { MasterDataService } from '../master-data/master-data.service';
import { moneyProblem, normalise, priceInEffect } from './domain/recipe-rules';
import type {
  CreateMenuItemDto,
  MenuItemDetailView,
  MenuItemsQueryDto,
  MenuItemView,
  MenuPriceView,
  SetMenuPriceDto,
  UpdateMenuItemDto,
} from './dto/menu.dto';

/** The master data entity types the menu is logged under (contract 1.1). */
export const MENU_ITEM_ENTITY = 'menu_item';
export const MENU_PRICE_ENTITY = 'menu_price';

const MENU_ITEM_SELECT = {
  id: true,
  code: true,
  nameTh: true,
  nameEn: true,
  categoryTh: true,
  categoryEn: true,
  soldBy: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  modifierGroups: {
    select: { group: { select: { id: true, code: true, nameTh: true, nameEn: true } } },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.MenuItemSelect;

const PRICE_SELECT = {
  id: true,
  effectiveFrom: true,
  price: true,
  version: true,
  location: { select: { id: true, code: true, nameTh: true, nameEn: true } },
} satisfies Prisma.MenuPriceSelect;

type MenuItemRow = Prisma.MenuItemGetPayload<{ select: typeof MENU_ITEM_SELECT }>;
type PriceRow = Prisma.MenuPriceGetPayload<{ select: typeof PRICE_SELECT }>;

/**
 * Menu items and their prices (#16, ADR-0002, ADR-0023): what branches sell, kept in the ERP
 * and mirrored by every connected POS through the master data change log. Each change commits
 * with its change log entry and its audit entry, or not at all. Menu items are deactivated,
 * never deleted; code and `soldBy` never change. A price is set from an effective-from date
 * and can be corrected only until that day comes.
 */
@Injectable()
export class MenuItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterData: MasterDataService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly locations: LocationsService,
  ) {}

  async list(query: MenuItemsQueryDto): Promise<MenuItemView[]> {
    const where: Prisma.MenuItemWhereInput = {};
    if (query.status !== 'all') where.active = query.status === 'active';
    if (query.q) {
      where.OR = (['code', 'nameTh', 'nameEn', 'categoryTh', 'categoryEn'] as const).map(
        (field) => ({ [field]: { contains: query.q, mode: 'insensitive' } }),
      );
    }
    const rows = await this.prisma.menuItem.findMany({
      where,
      select: { ...MENU_ITEM_SELECT, prices: { select: PRICE_SELECT } },
      orderBy: [{ categoryEn: 'asc' }, { code: 'asc' }],
    });
    const today = this.ledger.today();
    return rows.map(({ prices, ...row }) => toView(row, prices, today));
  }

  async get(id: string): Promise<MenuItemDetailView> {
    const row = await this.prisma.menuItem.findUnique({
      where: { id },
      select: { ...MENU_ITEM_SELECT, prices: { select: PRICE_SELECT } },
    });
    if (!row) throw new NotFoundError('MenuItem', id);
    const today = this.ledger.today();
    const { prices, ...item } = row;
    return { ...toView(item, prices, today), prices: priceViews(prices, today) };
  }

  async create(
    dto: CreateMenuItemDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<MenuItemDetailView> {
    const groups = await this.knownGroups(dto.modifierGroupIds);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const version = await this.masterData.nextVersion(tx);
        const item = await tx.menuItem.create({
          data: {
            code: dto.code,
            nameTh: dto.nameTh,
            nameEn: dto.nameEn,
            categoryTh: dto.categoryTh,
            categoryEn: dto.categoryEn,
            soldBy: dto.soldBy as MenuSoldBy,
            version,
            modifierGroups: {
              create: groups.map((group, position) => ({ groupId: group.id, position })),
            },
          },
          select: MENU_ITEM_SELECT,
        });
        await this.recordItem(tx, item, MasterDataAction.created);
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'MenuItem',
          entityId: item.id,
          summary: `Created menu item ${item.code} (${item.nameEn})`,
          changes: itemSnapshot(item),
          ...meta,
        });
        return item;
      });
      return this.get(row.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'MENU_ITEM_CODE_TAKEN',
          `A menu item with code ${dto.code} already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Changes the given fields. Refused when `dto.version` is not the menu item's current
   * version. A request that changes nothing records nothing and keeps the version.
   */
  async update(
    id: string,
    dto: UpdateMenuItemDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<MenuItemDetailView> {
    const groups = dto.modifierGroupIds ? await this.knownGroups(dto.modifierGroupIds) : null;
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockItem(tx, id);
      if (Number(current.version) !== dto.version) {
        throw new ConflictError(
          'MENU_ITEM_CHANGED',
          'This menu item was changed by someone else since you opened it. Reload it and try again.',
          { currentVersion: Number(current.version) },
        );
      }
      const changes = diff(current, dto, groups);
      if (Object.keys(changes).length === 0) return;

      const version = await this.masterData.nextVersion(tx);
      if (groups) {
        await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId: id } });
        await tx.menuItemModifierGroup.createMany({
          data: groups.map((group, position) => ({ menuItemId: id, groupId: group.id, position })),
        });
      }
      const item = await tx.menuItem.update({
        where: { id },
        data: {
          nameTh: dto.nameTh,
          nameEn: dto.nameEn,
          categoryTh: dto.categoryTh,
          categoryEn: dto.categoryEn,
          active: dto.active,
          version,
        },
        select: MENU_ITEM_SELECT,
      });
      await this.recordItem(tx, item, MasterDataAction.updated);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'MenuItem',
        entityId: item.id,
        summary: `${summaryVerb(changes)} menu item ${item.code} (${item.nameEn})`,
        changes,
        ...meta,
      });
    });
    return this.get(id);
  }

  /**
   * Sets the chain-wide price, or a branch's, from a business date: today or later. Setting
   * it again for the same menu item, branch and day corrects it, but only until that day
   * comes; from then on it is history, and a later price replaces it.
   */
  async setPrice(
    menuItemId: string,
    dto: SetMenuPriceDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<MenuItemDetailView> {
    if (!isIsoDate(dto.effectiveFrom)) {
      throw new BusinessRuleError(
        'INVALID_DATE',
        'effectiveFrom must be a real date written YYYY-MM-DD',
        {
          field: 'effectiveFrom',
        },
      );
    }
    const problem = moneyProblem(dto.price, false);
    if (problem) {
      throw new BusinessRuleError('INVALID_PRICE', `price is ${problem.replaceAll('_', ' ')}`, {
        field: 'price',
        problem,
      });
    }
    const today = this.ledger.today();
    if (compareDates(dto.effectiveFrom, today) < 0) {
      throw new BusinessRuleError(
        'EFFECTIVE_FROM_IN_PAST',
        'A price starts today or later: the POS has already sold at the price of a day that has passed',
        { field: 'effectiveFrom', earliest: today },
      );
    }
    const branch = dto.locationId ? await this.branch(dto.locationId) : null;
    const price = normalise(dto.price);

    await this.prisma.$transaction(async (tx) => {
      const item = await this.lockItem(tx, menuItemId);
      const existing = await tx.menuPrice.findFirst({
        where: {
          menuItemId,
          locationId: branch?.id ?? null,
          effectiveFrom: dateValue(dto.effectiveFrom),
        },
        select: PRICE_SELECT,
      });
      if (existing && compareDates(dateText(existing.effectiveFrom), today) <= 0) {
        throw new ConflictError(
          'PRICE_IN_EFFECT',
          'That price has already started: set a new price from a later day instead',
          { priceId: existing.id },
        );
      }
      if (existing && normalise(existing.price.toFixed()) === price) return;

      const version = await this.masterData.nextVersion(tx);
      const row = existing
        ? await tx.menuPrice.update({
            where: { id: existing.id },
            data: { price, version },
            select: PRICE_SELECT,
          })
        : await tx.menuPrice.create({
            data: {
              menuItemId,
              locationId: branch?.id ?? null,
              effectiveFrom: dateValue(dto.effectiveFrom),
              price,
              version,
            },
            select: PRICE_SELECT,
          });
      const action = existing ? MasterDataAction.updated : MasterDataAction.created;
      await this.masterData.append(tx, row.version, {
        entityType: MENU_PRICE_ENTITY,
        entityId: row.id,
        entityCode: item.code,
        action,
        data: { ...priceSnapshot(item.code, row), version: Number(row.version) },
      });
      const where = branch ? `at ${branch.code}` : 'chain-wide';
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
        entityType: 'MenuPrice',
        entityId: row.id,
        summary: existing
          ? `Corrected the ${where} price of ${item.code} from ${dto.effectiveFrom}: ${price} baht`
          : `Set the ${where} price of ${item.code} from ${dto.effectiveFrom}: ${price} baht`,
        changes: existing
          ? { price: { from: normalise(existing.price.toFixed()), to: price } }
          : priceSnapshot(item.code, row),
        ...meta,
      });
    });
    return this.get(menuItemId);
  }

  /** The menu item's code and how it is sold, for a recipe or another module (#16, #17). */
  async describe(
    id: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<{ id: string; code: string; nameTh: string; nameEn: string; soldBy: MenuSoldBy }> {
    const row = await tx.menuItem.findUnique({
      where: { id },
      select: { id: true, code: true, nameTh: true, nameEn: true, soldBy: true },
    });
    if (!row) throw new NotFoundError('MenuItem', id);
    return row;
  }

  private async recordItem(
    tx: Prisma.TransactionClient,
    item: MenuItemRow,
    action: MasterDataAction,
  ): Promise<void> {
    await this.masterData.append(tx, item.version, {
      entityType: MENU_ITEM_ENTITY,
      entityId: item.id,
      entityCode: item.code,
      action,
      data: { ...itemSnapshot(item), version: Number(item.version) },
    });
  }

  /** The groups in the order given, after checking each id names an active modifier group. */
  private async knownGroups(ids: readonly string[]): Promise<Array<{ id: string; code: string }>> {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) {
      throw new BusinessRuleError('DUPLICATE_MODIFIER_GROUP', 'A modifier group is listed twice', {
        field: 'modifierGroupIds',
      });
    }
    const found = await this.prisma.modifierGroup.findMany({
      where: { id: { in: unique }, active: true },
      select: { id: true, code: true },
    });
    const known = new Map(found.map((g) => [g.id, g]));
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new BusinessRuleError(
        'UNKNOWN_MODIFIER_GROUP',
        'A modifier group does not exist or is inactive',
        { field: 'modifierGroupIds', ids: missing },
      );
    }
    return unique.map((id) => known.get(id)!);
  }

  /** An active branch: prices are set chain-wide or per branch, never per plant (ADR-0002). */
  private async branch(locationId: string) {
    const location = (await this.locations.describe([locationId])).get(locationId);
    if (!location || location.type !== 'branch' || !location.active) {
      throw new BusinessRuleError('NOT_A_BRANCH', 'A branch price is set for an active branch', {
        field: 'locationId',
      });
    }
    return location;
  }

  /** The menu item, locked for the rest of the transaction so concurrent edits queue up. */
  private async lockItem(tx: Prisma.TransactionClient, id: string): Promise<MenuItemRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM menu_items WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (locked.length === 0) throw new NotFoundError('MenuItem', id);
    return tx.menuItem.findUniqueOrThrow({ where: { id }, select: MENU_ITEM_SELECT });
  }
}

/** A DATE column's value for a YYYY-MM-DD business date. */
export function dateValue(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function dateText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toView(item: MenuItemRow, prices: PriceRow[], today: string): MenuItemView {
  const current = priceInEffect(
    prices.map((p) => ({
      ...p,
      locationCode: p.location?.code ?? null,
      effectiveFrom: dateText(p.effectiveFrom),
    })),
    null,
    today,
  );
  return {
    id: item.id,
    code: item.code,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    categoryTh: item.categoryTh,
    categoryEn: item.categoryEn,
    soldBy: item.soldBy,
    active: item.active,
    modifierGroups: item.modifierGroups.map((g) => g.group),
    currentPrice: current ? normalise(current.price.toFixed()) : null,
    version: Number(item.version),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function priceViews(prices: PriceRow[], today: string): MenuPriceView[] {
  const dated = prices.map((p) => ({
    row: p,
    locationCode: p.location?.code ?? null,
    effectiveFrom: dateText(p.effectiveFrom),
  }));
  return dated
    .map(({ row, locationCode, effectiveFrom }) => {
      const sameScope = dated.filter((d) => d.locationCode === locationCode);
      const inForce = priceInEffect(sameScope, locationCode, today);
      const status: MenuPriceView['status'] =
        compareDates(effectiveFrom, today) > 0
          ? 'scheduled'
          : inForce?.row.id === row.id
            ? 'current'
            : 'past';
      return {
        id: row.id,
        location: row.location,
        effectiveFrom,
        price: normalise(row.price.toFixed()),
        status,
        version: Number(row.version),
      };
    })
    .sort(
      (a, b) =>
        compareDates(b.effectiveFrom, a.effectiveFrom) ||
        (a.location?.code ?? '').localeCompare(b.location?.code ?? ''),
    );
}

/**
 * The menu item as a mirror or an auditor needs it. Codes are spelled `menuItemCode` and
 * `modifierGroupCodes` because the audit trail redacts any field called `code`; the change
 * log uses the same shape so the two read alike.
 */
function itemSnapshot(item: MenuItemRow) {
  return {
    id: item.id,
    menuItemCode: item.code,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    categoryTh: item.categoryTh,
    categoryEn: item.categoryEn,
    soldBy: item.soldBy,
    active: item.active,
    modifierGroupCodes: item.modifierGroups.map((g) => g.group.code),
  };
}

function priceSnapshot(menuItemCode: string, row: PriceRow) {
  return {
    id: row.id,
    menuItemCode,
    locationCode: row.location?.code ?? null,
    effectiveFrom: dateText(row.effectiveFrom),
    price: normalise(row.price.toFixed()),
  };
}

type Changes = Record<string, { from: unknown; to: unknown }>;

function diff(
  current: MenuItemRow,
  next: UpdateMenuItemDto,
  groups: Array<{ id: string; code: string }> | null,
): Changes {
  const changes: Changes = {};
  const scalar = ['nameTh', 'nameEn', 'categoryTh', 'categoryEn', 'active'] as const;
  for (const field of scalar) {
    const to = next[field];
    if (to !== undefined && to !== current[field]) changes[field] = { from: current[field], to };
  }
  if (groups) {
    const from = current.modifierGroups.map((g) => g.group.code);
    const to = groups.map((g) => g.code);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.modifierGroups = { from, to };
  }
  return changes;
}

function summaryVerb(changes: Changes): string {
  if (Object.keys(changes).length === 1 && changes.active) {
    return changes.active.to ? 'Reactivated' : 'Deactivated';
  }
  return 'Updated';
}

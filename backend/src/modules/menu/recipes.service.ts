// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import { AuditAction, MasterDataAction, Prisma } from '@prisma/client';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { compareDates, isIsoDate } from '../../core/time/domain/business-date';
import { AuditService } from '../audit/audit.service';
import { ItemsService, type ItemFacts } from '../items/items.service';
import { LedgerService } from '../ledger/ledger.service';
import { MasterDataService } from '../master-data/master-data.service';
import {
  hasTakenEffect,
  newVersionProblem,
  normalise,
  recipeCost,
  recipeInEffect,
  recipeLineIssues,
  type RecipeKind,
} from './domain/recipe-rules';
import type {
  CreateRecipeVersionDto,
  RecipeLineDto,
  RecipeLinesDto,
  RecipeVersionView,
  RecipeView,
} from './dto/menu.dto';
import { dateText, dateValue, MenuItemsService } from './menu-items.service';
import { ModifierGroupsService } from './modifier-groups.service';
import {
  saleUsage,
  type SaleLine,
  type SaleModifierOption,
  type SaleUsage,
} from './domain/sale-usage';

/** The master data entity types recipe versions are logged under (contract 1.1). */
export const MENU_RECIPE_ENTITY = 'menu_recipe';
export const MODIFIER_RECIPE_ENTITY = 'modifier_recipe';

const VERSION_SELECT = {
  id: true,
  menuItemId: true,
  modifierOptionId: true,
  number: true,
  effectiveFrom: true,
  version: true,
  lines: {
    select: { lineNo: true, itemId: true, quantity: true },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.RecipeVersionSelect;

type VersionRow = Prisma.RecipeVersionGetPayload<{ select: typeof VERSION_SELECT }>;

interface Subject {
  kind: RecipeKind;
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  per: RecipeView['subject']['per'];
}

/**
 * Versioned menu and modifier recipes (#16, ADR-0002, ADR-0005, ADR-0023). A version is in
 * force from its effective-from date until the next one starts; versions of one recipe never
 * start on the same day, never start in the past, and never change once in force. Each new
 * or corrected version commits with its change log entry and its audit entry, or not at all.
 */
@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterData: MasterDataService,
    private readonly audit: AuditService,
    private readonly items: ItemsService,
    private readonly ledger: LedgerService,
    private readonly menuItems: MenuItemsService,
    private readonly modifierGroups: ModifierGroupsService,
  ) {}

  /**
   * What one sale line uses (#17): the menu item's and its modifiers' recipes in force on the
   * sale date, exploded per item, or why not. A menu item or option no longer on sale still
   * uses its recipe: the sale happened. Pass the caller's transaction to read inside it.
   */
  async saleUsage(
    line: SaleLine,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<{ menuItemId: string | null; usage: SaleUsage }> {
    const recipeVersions = {
      select: {
        effectiveFrom: true,
        lines: { select: { itemId: true, quantity: true }, orderBy: { lineNo: 'asc' as const } },
      },
    };
    const menuItem = await tx.menuItem.findUnique({
      where: { code: line.menuItemCode },
      select: { id: true, code: true, soldBy: true, recipeVersions },
    });
    const optionRows = line.modifiers.length
      ? await tx.modifierOption.findMany({
          where: { code: { in: [...new Set(line.modifiers.map((m) => m.code))] } },
          select: { id: true, code: true, recipeVersions },
        })
      : [];
    const dated = (versions: (typeof optionRows)[number]['recipeVersions']) =>
      versions.map((version) => ({
        effectiveFrom: dateText(version.effectiveFrom),
        lines: version.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity.toFixed() })),
      }));
    const options = new Map<string, SaleModifierOption>(
      optionRows.map((row) => [
        row.code,
        { id: row.id, code: row.code, recipes: dated(row.recipeVersions) },
      ]),
    );
    const itemIds = [
      ...(menuItem?.recipeVersions ?? []),
      ...optionRows.flatMap((row) => row.recipeVersions),
    ].flatMap((version) => version.lines.map((l) => l.itemId));
    const items = await this.items.describe(itemIds, tx);
    const active = new Set([...items.values()].filter((i) => i.active).map((i) => i.id));
    return {
      menuItemId: menuItem?.id ?? null,
      usage: saleUsage(
        line,
        menuItem
          ? {
              id: menuItem.id,
              code: menuItem.code,
              soldBy: menuItem.soldBy,
              recipes: dated(menuItem.recipeVersions),
            }
          : null,
        options,
        active,
      ),
    };
  }

  /** Every version of the recipe, newest first, each priced at current lot costs. */
  async recipe(kind: RecipeKind, subjectId: string): Promise<RecipeView> {
    const subject = await this.subject(kind, subjectId);
    const rows = await this.prisma.recipeVersion.findMany({
      where: kind === 'menu' ? { menuItemId: subjectId } : { modifierOptionId: subjectId },
      select: VERSION_SELECT,
      orderBy: { effectiveFrom: 'desc' },
    });
    const itemIds = rows.flatMap((r) => r.lines.map((l) => l.itemId));
    const [items, costs] = await Promise.all([
      this.items.describe(itemIds),
      this.ledger.currentLotCosts(itemIds),
    ]);
    const today = this.ledger.today();
    const dated = rows.map((row) => ({ row, effectiveFrom: dateText(row.effectiveFrom) }));
    const current = recipeInEffect(dated, today);

    const versions = dated.map(({ row, effectiveFrom }): RecipeVersionView => {
      const lines = row.lines.map((line) => {
        const item = items.get(line.itemId)!;
        const cost = costs.get(line.itemId) ?? null;
        return {
          lineNo: line.lineNo,
          item: {
            id: item.id,
            code: item.code,
            nameTh: item.nameTh,
            nameEn: item.nameEn,
            baseUnitCode: item.baseUnitCode,
          },
          quantity: normalise(line.quantity.toFixed()),
          unitCost: cost?.unitCost ?? null,
          costLot: cost?.lotNumber ?? null,
        };
      });
      const priced = recipeCost(lines);
      return {
        id: row.id,
        number: row.number,
        effectiveFrom,
        status:
          current?.row.id === row.id
            ? 'current'
            : compareDates(effectiveFrom, today) > 0
              ? 'scheduled'
              : 'past',
        lines: lines.map((line, i) => ({ ...line, cost: priced.lines[i] })),
        theoreticalCost: { total: priced.total, complete: priced.complete },
        version: Number(row.version),
      };
    });
    return { subject, today, versions };
  }

  /**
   * A new version from `effectiveFrom`: today when the recipe has none in force yet, else
   * tomorrow at the earliest, and never on a day another version starts.
   */
  async addVersion(
    kind: RecipeKind,
    subjectId: string,
    dto: CreateRecipeVersionDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<RecipeView> {
    if (!isIsoDate(dto.effectiveFrom)) {
      throw new BusinessRuleError(
        'INVALID_DATE',
        'effectiveFrom must be a real date written YYYY-MM-DD',
        {
          field: 'effectiveFrom',
        },
      );
    }
    const items = await this.validLines(kind, dto.lines);
    const today = this.ledger.today();

    await this.prisma.$transaction(async (tx) => {
      const subject = await this.lockSubject(tx, kind, subjectId);
      const existing = await tx.recipeVersion.findMany({
        where: kind === 'menu' ? { menuItemId: subjectId } : { modifierOptionId: subjectId },
        select: { number: true, effectiveFrom: true },
      });
      const problem = newVersionProblem(
        existing.map((v) => ({ effectiveFrom: dateText(v.effectiveFrom) })),
        dto.effectiveFrom,
        today,
      );
      if (problem?.reason === 'overlap') {
        throw new ConflictError(
          'RECIPE_VERSION_OVERLAP',
          'Another version of this recipe starts on that day: two versions would be in force at once',
          { field: 'effectiveFrom' },
        );
      }
      if (problem?.reason === 'too_early') {
        throw new BusinessRuleError(
          'RECIPE_TOO_EARLY',
          `A new version starts on ${problem.earliest} at the earliest: a recipe never changes for a day that has begun`,
          { field: 'effectiveFrom', earliest: problem.earliest },
        );
      }

      const version = await this.masterData.nextVersion(tx);
      const row = await tx.recipeVersion.create({
        data: {
          ...(kind === 'menu' ? { menuItemId: subjectId } : { modifierOptionId: subjectId }),
          number: Math.max(0, ...existing.map((v) => v.number)) + 1,
          effectiveFrom: dateValue(dto.effectiveFrom),
          version,
          lines: { create: lineData(dto.lines) },
        },
        select: VERSION_SELECT,
      });
      await this.record(tx, subject, row, items, MasterDataAction.created);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'RecipeVersion',
        entityId: row.id,
        summary: `Created version ${row.number} of the recipe for ${subject.code}, from ${dto.effectiveFrom}`,
        changes: snapshot(subject, row, items),
        ...meta,
      });
    });
    return this.recipe(kind, subjectId);
  }

  /** Replaces the lines of a version that has not taken effect yet. */
  async replaceLines(
    versionId: string,
    dto: RecipeLinesDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<RecipeView> {
    const found = await this.prisma.recipeVersion.findUnique({
      where: { id: versionId },
      select: { menuItemId: true, modifierOptionId: true },
    });
    if (!found) throw new NotFoundError('RecipeVersion', versionId);
    const kind: RecipeKind = found.menuItemId ? 'menu' : 'modifier';
    const subjectId = (found.menuItemId ?? found.modifierOptionId)!;
    await this.validLines(kind, dto.lines);
    const today = this.ledger.today();

    await this.prisma.$transaction(async (tx) => {
      const subject = await this.lockSubject(tx, kind, subjectId);
      const current = await tx.recipeVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: VERSION_SELECT,
      });
      if (hasTakenEffect({ effectiveFrom: dateText(current.effectiveFrom) }, today)) {
        throw new ConflictError(
          'RECIPE_VERSION_IN_EFFECT',
          'This version is in force or has been: it never changes. Add a new version instead.',
        );
      }
      const before = linesOf(current);
      const after = lineData(dto.lines);
      if (JSON.stringify(before) === JSON.stringify(after)) return;

      const version = await this.masterData.nextVersion(tx);
      await tx.recipeLine.deleteMany({ where: { recipeVersionId: versionId } });
      await tx.recipeLine.createMany({
        data: after.map((line) => ({ ...line, recipeVersionId: versionId })),
      });
      const row = await tx.recipeVersion.update({
        where: { id: versionId },
        data: { version },
        select: VERSION_SELECT,
      });
      const allItems = await this.items.describe(
        [...before, ...after].map((l) => l.itemId),
        tx,
      );
      await this.record(tx, subject, row, allItems, MasterDataAction.updated);
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'RecipeVersion',
        entityId: row.id,
        summary: `Corrected version ${row.number} of the recipe for ${subject.code} before it starts`,
        changes: {
          lines: {
            from: linesSnapshot(before, allItems),
            to: linesSnapshot(after, allItems),
          },
        },
        ...meta,
      });
    });
    return this.recipe(kind, subjectId);
  }

  private async subject(
    kind: RecipeKind,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Subject> {
    if (kind === 'menu') {
      const item = await this.menuItems.describe(id, tx);
      return {
        kind,
        id,
        code: item.code,
        nameTh: item.nameTh,
        nameEn: item.nameEn,
        per: item.soldBy === 'weight' ? 'kg' : 'portion',
      };
    }
    const option = await this.modifierGroups.describeOption(id, tx);
    return {
      kind,
      id,
      code: option.code,
      nameTh: option.nameTh,
      nameEn: option.nameEn,
      per: 'unit_sold',
    };
  }

  /** The recipe's owner, locked so two new versions of one recipe are numbered one at a time. */
  private async lockSubject(
    tx: Prisma.TransactionClient,
    kind: RecipeKind,
    id: string,
  ): Promise<Subject> {
    if (kind === 'menu') {
      await tx.$queryRaw`SELECT id FROM menu_items WHERE id = ${id}::uuid FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM modifier_options WHERE id = ${id}::uuid FOR UPDATE`;
    }
    return this.subject(kind, id, tx);
  }

  /** The items the lines name, after checking every line; refused with every problem at once. */
  private async validLines(
    kind: RecipeKind,
    lines: readonly RecipeLineDto[],
  ): Promise<Map<string, ItemFacts>> {
    const items = await this.items.describe(lines.map((l) => l.itemId));
    const issues = recipeLineIssues(kind, lines, items);
    if (issues.length > 0) {
      throw new BusinessRuleError(
        'INVALID_RECIPE_LINES',
        issues.map((i) => `Line ${i.lineNo}: ${i.problem.replaceAll('_', ' ')}`).join('; '),
        { issues },
      );
    }
    return items;
  }

  private async record(
    tx: Prisma.TransactionClient,
    subject: Subject,
    row: VersionRow,
    items: ReadonlyMap<string, ItemFacts>,
    action: MasterDataAction,
  ): Promise<void> {
    await this.masterData.append(tx, row.version, {
      entityType: subject.kind === 'menu' ? MENU_RECIPE_ENTITY : MODIFIER_RECIPE_ENTITY,
      entityId: row.id,
      entityCode: subject.code,
      action,
      data: { ...snapshot(subject, row, items), version: Number(row.version) },
    });
  }
}

function lineData(lines: readonly RecipeLineDto[]) {
  return lines.map((line, index) => ({
    lineNo: index + 1,
    itemId: line.itemId,
    quantity: normalise(line.quantity),
  }));
}

function linesOf(row: VersionRow) {
  return row.lines.map((line) => ({
    lineNo: line.lineNo,
    itemId: line.itemId,
    quantity: normalise(line.quantity.toFixed()),
  }));
}

function linesSnapshot(
  lines: ReadonlyArray<{ itemId: string; quantity: string }>,
  items: ReadonlyMap<string, ItemFacts>,
) {
  return lines.map((line) => {
    const item = items.get(line.itemId)!;
    return { itemCode: item.code, quantity: line.quantity, unitCode: item.baseUnitCode };
  });
}

/**
 * The version as a mirror or an auditor needs it. Codes are spelled `menuItemCode`,
 * `modifierCode` and `itemCode` because the audit trail redacts any field called `code`.
 */
function snapshot(subject: Subject, row: VersionRow, items: ReadonlyMap<string, ItemFacts>) {
  return {
    id: row.id,
    ...(subject.kind === 'menu'
      ? { menuItemCode: subject.code, per: subject.per }
      : { modifierCode: subject.code }),
    number: row.number,
    effectiveFrom: dateText(row.effectiveFrom),
    lines: linesSnapshot(linesOf(row), items),
  };
}

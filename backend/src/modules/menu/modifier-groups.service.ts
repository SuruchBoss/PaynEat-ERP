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
import { moneyProblem, normalise } from './domain/recipe-rules';
import type {
  CreateModifierGroupDto,
  ModifierGroupView,
  ModifierOptionDto,
  UpdateModifierGroupDto,
} from './dto/menu.dto';

/** The master data entity type modifier groups, with their options, are logged under. */
export const MODIFIER_GROUP_ENTITY = 'modifier_group';

const GROUP_SELECT = {
  id: true,
  code: true,
  nameTh: true,
  nameEn: true,
  minSelections: true,
  maxSelections: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  options: {
    select: {
      id: true,
      code: true,
      nameTh: true,
      nameEn: true,
      priceChange: true,
      active: true,
      position: true,
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.ModifierGroupSelect;

type GroupRow = Prisma.ModifierGroupGetPayload<{ select: typeof GROUP_SELECT }>;

/**
 * Modifier groups and their options (#16): the choices a menu item offers, such as a sauce,
 * each option with a price change and the code sales events carry as `modifiers[].code`.
 * A group travels in the change log with all its options. Groups and options are
 * deactivated, never deleted; codes never change, and option codes are unique across groups.
 */
@Injectable()
export class ModifierGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterData: MasterDataService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ModifierGroupView[]> {
    const rows = await this.prisma.modifierGroup.findMany({
      select: GROUP_SELECT,
      orderBy: { code: 'asc' },
    });
    return rows.map(toView);
  }

  async get(id: string): Promise<ModifierGroupView> {
    const row = await this.prisma.modifierGroup.findUnique({ where: { id }, select: GROUP_SELECT });
    if (!row) throw new NotFoundError('ModifierGroup', id);
    return toView(row);
  }

  async create(
    dto: CreateModifierGroupDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ModifierGroupView> {
    const options = validOptions(dto.options, []);
    checkSelections(dto.minSelections, dto.maxSelections, options);
    await this.refuseTakenOptionCodes(options, null);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const version = await this.masterData.nextVersion(tx);
        const group = await tx.modifierGroup.create({
          data: {
            code: dto.code,
            nameTh: dto.nameTh,
            nameEn: dto.nameEn,
            minSelections: dto.minSelections,
            maxSelections: dto.maxSelections,
            version,
            options: {
              create: options.map((option, position) => ({
                code: option.code,
                nameTh: option.nameTh,
                nameEn: option.nameEn,
                priceChange: option.priceChange,
                active: option.active,
                position,
              })),
            },
          },
          select: GROUP_SELECT,
        });
        await this.record(tx, group, MasterDataAction.created);
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'ModifierGroup',
          entityId: group.id,
          summary: `Created modifier group ${group.code} (${group.nameEn})`,
          changes: snapshot(group),
          ...meta,
        });
        return group;
      });
      return toView(row);
    } catch (error) {
      throw codeTaken(error, dto.code);
    }
  }

  /**
   * Changes the given fields. Refused when `dto.version` is not the group's current version.
   * `options` is the whole list in its new order; an existing option left out is refused
   * (deactivate it instead), and an option with a new code is added.
   */
  async update(
    id: string,
    dto: UpdateModifierGroupDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<ModifierGroupView> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const current = await this.lock(tx, id);
        if (Number(current.version) !== dto.version) {
          throw new ConflictError(
            'MODIFIER_GROUP_CHANGED',
            'This modifier group was changed by someone else since you opened it. Reload it and try again.',
            { currentVersion: Number(current.version) },
          );
        }
        const options = dto.options
          ? validOptions(dto.options, current.options)
          : current.options.map((o) => ({
              code: o.code,
              nameTh: o.nameTh,
              nameEn: o.nameEn,
              priceChange: normalise(o.priceChange.toFixed()),
              active: o.active,
            }));
        checkSelections(
          dto.minSelections ?? current.minSelections,
          dto.maxSelections ?? current.maxSelections,
          options,
        );
        await this.refuseTakenOptionCodes(options, id, tx);
        const changes = diff(current, dto, options);
        if (Object.keys(changes).length === 0) return current;

        const version = await this.masterData.nextVersion(tx);
        const existing = new Map(current.options.map((o) => [o.code, o]));
        for (const [position, option] of options.entries()) {
          const data = {
            nameTh: option.nameTh,
            nameEn: option.nameEn,
            priceChange: option.priceChange,
            active: option.active,
            position,
          };
          const known = existing.get(option.code);
          if (known) await tx.modifierOption.update({ where: { id: known.id }, data });
          else
            await tx.modifierOption.create({ data: { ...data, groupId: id, code: option.code } });
        }
        const group = await tx.modifierGroup.update({
          where: { id },
          data: {
            nameTh: dto.nameTh,
            nameEn: dto.nameEn,
            minSelections: dto.minSelections,
            maxSelections: dto.maxSelections,
            active: dto.active,
            version,
          },
          select: GROUP_SELECT,
        });
        await this.record(tx, group, MasterDataAction.updated);
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.UPDATE,
          entityType: 'ModifierGroup',
          entityId: group.id,
          summary: `${summaryVerb(changes)} modifier group ${group.code} (${group.nameEn})`,
          changes,
          ...meta,
        });
        return group;
      });
      return toView(row);
    } catch (error) {
      throw codeTaken(error, '');
    }
  }

  /** A modifier option with its group's code, for a recipe (#16) or another module (#17). */
  async describeOption(
    id: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<{ id: string; code: string; nameTh: string; nameEn: string }> {
    const row = await tx.modifierOption.findUnique({
      where: { id },
      select: { id: true, code: true, nameTh: true, nameEn: true },
    });
    if (!row) throw new NotFoundError('ModifierOption', id);
    return row;
  }

  private async record(
    tx: Prisma.TransactionClient,
    group: GroupRow,
    action: MasterDataAction,
  ): Promise<void> {
    await this.masterData.append(tx, group.version, {
      entityType: MODIFIER_GROUP_ENTITY,
      entityId: group.id,
      entityCode: group.code,
      action,
      data: { ...snapshot(group), version: Number(group.version) },
    });
  }

  /**
   * Option codes are unique across groups (sales events carry only the option's code): one
   * another group already uses is refused by name. The unique index stays the last word.
   */
  private async refuseTakenOptionCodes(
    options: readonly OptionFields[],
    groupId: string | null,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const taken = await tx.modifierOption.findMany({
      where: {
        code: { in: options.map((o) => o.code) },
        ...(groupId ? { groupId: { not: groupId } } : {}),
      },
      select: { code: true },
    });
    if (taken.length > 0) {
      throw new ConflictError(
        'MODIFIER_CODE_TAKEN',
        'An option code is already used by another modifier group: option codes are unique',
        { field: 'options', codes: taken.map((t) => t.code) },
      );
    }
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<GroupRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM modifier_groups WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (locked.length === 0) throw new NotFoundError('ModifierGroup', id);
    return tx.modifierGroup.findUniqueOrThrow({ where: { id }, select: GROUP_SELECT });
  }
}

interface OptionFields {
  code: string;
  nameTh: string;
  nameEn: string;
  priceChange: string;
  active: boolean;
}

/** The options as stored: price changes normalised, every existing code still present. */
function validOptions(
  options: readonly ModifierOptionDto[],
  existing: GroupRow['options'],
): OptionFields[] {
  const codes = options.map((o) => o.code);
  const repeated = codes.filter((code, i) => codes.indexOf(code) !== i);
  if (repeated.length > 0) {
    throw new BusinessRuleError('DUPLICATE_MODIFIER_OPTION', 'An option code is listed twice', {
      field: 'options',
      codes: [...new Set(repeated)],
    });
  }
  const removed = existing.map((o) => o.code).filter((code) => !codes.includes(code));
  if (removed.length > 0) {
    throw new BusinessRuleError(
      'MODIFIER_OPTION_REMOVED',
      'An option is never removed: sales may carry its code. Deactivate it instead.',
      { field: 'options', codes: removed },
    );
  }
  return options.map((option, index) => {
    const problem = moneyProblem(option.priceChange, true);
    if (problem) {
      throw new BusinessRuleError(
        'INVALID_PRICE',
        `Option ${index + 1}: the price change is ${problem.replaceAll('_', ' ')}`,
        { field: 'options', lineNo: index + 1, problem },
      );
    }
    return {
      code: option.code,
      nameTh: option.nameTh,
      nameEn: option.nameEn,
      priceChange: normalise(option.priceChange),
      active: option.active ?? true,
    };
  });
}

/** At most `max`, at least `min`, and `min` reachable with the options that are active. */
function checkSelections(min: number, max: number, options: readonly OptionFields[]): void {
  const active = options.filter((o) => o.active).length;
  if (min > max || active === 0 || min > active) {
    throw new BusinessRuleError(
      'INVALID_SELECTIONS',
      'The fewest selections must be no more than the most, and no more than the active options',
      { minSelections: min, maxSelections: max, activeOptions: active },
    );
  }
}

/** A P2002 on a group or option code, as the conflict the person can act on. */
function codeTaken(error: unknown, groupCode: string): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return error;
  }
  // Both tables call the column `code`: the model name tells them apart.
  const meta = JSON.stringify(error.meta ?? {});
  if (meta.includes('modifier_options') || meta.includes('ModifierOption')) {
    return new ConflictError(
      'MODIFIER_CODE_TAKEN',
      'An option with that code already exists, in this group or another: option codes are unique',
    );
  }
  return new ConflictError(
    'MODIFIER_GROUP_CODE_TAKEN',
    `A modifier group with code ${groupCode} already exists`,
  );
}

function optionFields(group: GroupRow): OptionFields[] {
  return group.options.map((o) => ({
    code: o.code,
    nameTh: o.nameTh,
    nameEn: o.nameEn,
    priceChange: normalise(o.priceChange.toFixed()),
    active: o.active,
  }));
}

function toView(group: GroupRow): ModifierGroupView {
  return {
    id: group.id,
    code: group.code,
    nameTh: group.nameTh,
    nameEn: group.nameEn,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    active: group.active,
    options: group.options.map((o) => ({
      id: o.id,
      code: o.code,
      nameTh: o.nameTh,
      nameEn: o.nameEn,
      priceChange: normalise(o.priceChange.toFixed()),
      active: o.active,
    })),
    version: Number(group.version),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

/**
 * The group as a mirror or an auditor needs it, options in order. Codes are spelled
 * `groupCode` and `modifierCode` because the audit trail redacts any field called `code`.
 */
function snapshot(group: GroupRow) {
  return {
    id: group.id,
    groupCode: group.code,
    nameTh: group.nameTh,
    nameEn: group.nameEn,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    active: group.active,
    options: optionFields(group).map(({ code, ...rest }) => ({ modifierCode: code, ...rest })),
  };
}

type Changes = Record<string, { from: unknown; to: unknown }>;

function diff(current: GroupRow, next: UpdateModifierGroupDto, options: OptionFields[]): Changes {
  const changes: Changes = {};
  const scalar = ['nameTh', 'nameEn', 'minSelections', 'maxSelections', 'active'] as const;
  for (const field of scalar) {
    const to = next[field];
    if (to !== undefined && to !== current[field]) changes[field] = { from: current[field], to };
  }
  const from = optionFields(current).map(({ code, ...rest }) => ({ modifierCode: code, ...rest }));
  const to = options.map(({ code, ...rest }) => ({ modifierCode: code, ...rest }));
  if (JSON.stringify(from) !== JSON.stringify(to)) changes.options = { from, to };
  return changes;
}

function summaryVerb(changes: Changes): string {
  if (Object.keys(changes).length === 1 && changes.active) {
    return changes.active.to ? 'Reactivated' : 'Deactivated';
  }
  return 'Updated';
}

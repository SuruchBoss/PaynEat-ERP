// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import { AuditAction, MasterDataAction, Prisma, type LocationType } from '@prisma/client';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { labelRequestLocation } from '../../core/telemetry/request-context';
import { AuditService } from '../audit/audit.service';
import { MasterDataService } from '../master-data/master-data.service';
import {
  createProblem,
  editProblem,
  inTransitCode,
  locationCodeProblem,
  normaliseLocationCode,
  shipsThroughInTransit,
  supersedeProblem,
  type EditProblem,
  type SupersedeProblem,
} from './domain/location-rules';
import type {
  CreateLocationDto,
  LocationsQueryDto,
  LocationView,
  SupersedeLocationDto,
  UpdateLocationDto,
} from './dto/locations.dto';

const REF = { select: { id: true, code: true } } as const;
const LOCATION_SELECT = {
  id: true,
  code: true,
  type: true,
  nameTh: true,
  nameEn: true,
  active: true,
  originId: true,
  supersededById: true,
  firstUsedAt: true,
  firstUse: true,
  revision: true,
  masterDataVersion: true,
  createdAt: true,
  updatedAt: true,
  origin: REF,
  inTransit: REF,
  supersededBy: REF,
} satisfies Prisma.LocationSelect;

type LocationRow = Prisma.LocationGetPayload<{ select: typeof LOCATION_SELECT }>;
type Tx = Prisma.TransactionClient;

/** The master data entity type branches are logged under (#5, ADR-0002). */
export const LOCATION_ENTITY = 'location';

const EDIT_ERRORS: Record<EditProblem, [string, string]> = {
  SYSTEM_MANAGED: [
    'LOCATION_SYSTEM_MANAGED',
    'In-transit locations are managed by the system and cannot be changed',
  ],
  CODE_IN_USE: [
    'LOCATION_CODE_IN_USE',
    'This code is already in use and can no longer change. Create a new location and supersede this one.',
  ],
  SUPERSEDED: [
    'LOCATION_SUPERSEDED',
    'This location was superseded by another and stays out of use',
  ],
};

const SUPERSEDE_ERRORS: Record<SupersedeProblem, [string, string]> = {
  SYSTEM_MANAGED: [
    'LOCATION_SYSTEM_MANAGED',
    'In-transit locations are managed by the system and cannot be superseded',
  ],
  ALREADY_SUPERSEDED: ['LOCATION_SUPERSEDED', 'This location has already been superseded'],
  SAME_LOCATION: ['SUPERSEDE_SAME_LOCATION', 'A location cannot supersede itself'],
  DIFFERENT_TYPE: [
    'SUPERSEDE_DIFFERENT_TYPE',
    'A location can only be superseded by one of the same type',
  ],
  REPLACEMENT_INACTIVE: [
    'SUPERSEDE_REPLACEMENT_INACTIVE',
    'The replacement must be an active location that has not been superseded itself',
  ],
};

/**
 * Every place stock can be (#6). A person creates plants, warehouses and branches; the
 * system creates and manages each plant's and warehouse's in-transit location (ADR-0007).
 * A code can be corrected until the location is first used and is fixed after that
 * (docs/GLOSSARY.md "Location code"); a wrong code in use is replaced by a new location
 * that supersedes the old one. Branches are master data a POS pulls, so every change to
 * one takes the next master data version (#5). Every change is audited, and every log
 * line of a request about a location carries its `location_code`.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterData: MasterDataService,
    private readonly audit: AuditService,
  ) {}

  async list(query: LocationsQueryDto): Promise<LocationView[]> {
    const where: Prisma.LocationWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.status !== 'all') where.active = query.status === 'active';
    const rows = await this.prisma.location.findMany({
      where,
      select: LOCATION_SELECT,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toView);
  }

  async get(id: string): Promise<LocationView> {
    const row = await this.prisma.location.findUnique({ where: { id }, select: LOCATION_SELECT });
    if (!row) throw new NotFoundError('Location', id);
    labelRequestLocation(row.code);
    return toView(row);
  }

  async create(
    dto: CreateLocationDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<LocationView> {
    const refused = createProblem(dto.type);
    if (refused === 'TYPE_SYSTEM_MANAGED') {
      throw new BusinessRuleError(
        'LOCATION_TYPE_SYSTEM_MANAGED',
        'In-transit locations are created by the system with each plant and warehouse',
      );
    }
    if (refused === 'TYPE_RESERVED') {
      throw new BusinessRuleError(
        'LOCATION_TYPE_RESERVED',
        'Subcontractor locations are reserved and not available yet (ADR-0001)',
      );
    }
    const code = this.validCode(dto.code);
    labelRequestLocation(code);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const type = dto.type as LocationType;
        const version = type === 'branch' ? await this.masterData.nextVersion(tx) : null;
        const created = await tx.location.create({
          data: {
            code,
            type,
            nameTh: dto.nameTh,
            nameEn: dto.nameEn,
            masterDataVersion: version,
          },
          select: LOCATION_SELECT,
        });
        await this.audit.recordWithin(tx, {
          ...byActor(actor, meta),
          action: AuditAction.CREATE,
          entityType: 'Location',
          entityId: created.id,
          summary: `Created ${created.type} ${created.code} (${created.nameEn})`,
          changes: snapshot(created),
        });

        if (shipsThroughInTransit(dto.type)) {
          const inTransit = await tx.location.create({
            data: {
              code: inTransitCode(code),
              type: 'in_transit',
              ...inTransitNames(dto.nameTh, dto.nameEn),
              originId: created.id,
            },
            select: LOCATION_SELECT,
          });
          await this.audit.recordWithin(tx, {
            ...byActor(actor, meta),
            action: AuditAction.CREATE,
            entityType: 'Location',
            entityId: inTransit.id,
            summary: `Created ${inTransit.code} with ${created.code}`,
            changes: snapshot(inTransit),
          });
        }
        if (version !== null)
          await this.recordBranchChange(tx, created.id, MasterDataAction.created);
        return tx.location.findUniqueOrThrow({
          where: { id: created.id },
          select: LOCATION_SELECT,
        });
      });
      return toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'LOCATION_CODE_TAKEN',
          `A location with code ${code} already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Changes the given fields. Refused when `dto.revision` is not the location's current
   * revision, for an in-transit location, and for a code already in use. A plant's or
   * warehouse's in-transit location follows its code, names and active flag.
   */
  async update(
    id: string,
    dto: UpdateLocationDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<LocationView> {
    const code = dto.code === undefined ? undefined : normaliseLocationCode(dto.code);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const current = await this.lockLocation(tx, id);
        labelRequestLocation(current.code);
        this.assertRevision(current, dto.revision);

        const codeChanges = code !== undefined && code !== current.code;
        const refused = editProblem(current, { codeChanges, active: dto.active });
        if (refused) throw new BusinessRuleError(...EDIT_ERRORS[refused]);
        if (codeChanges) this.validCode(code);

        const changes = diff(current, {
          code,
          nameTh: dto.nameTh,
          nameEn: dto.nameEn,
          active: dto.active,
        });
        if (Object.keys(changes).length === 0) return current;

        const version =
          current.type === 'branch' ? await this.masterData.nextVersion(tx) : undefined;
        const updated = await tx.location.update({
          where: { id },
          data: {
            code: codeChanges ? code : undefined,
            nameTh: dto.nameTh,
            nameEn: dto.nameEn,
            active: dto.active,
            revision: { increment: 1 },
            masterDataVersion: version,
          },
          select: LOCATION_SELECT,
        });
        labelRequestLocation(updated.code);
        await this.followWithInTransit(tx, updated, actor, meta);
        await this.audit.recordWithin(tx, {
          ...byActor(actor, meta),
          action: AuditAction.UPDATE,
          entityType: 'Location',
          entityId: id,
          summary: updateSummary(current, updated, changes),
          changes,
        });
        if (version !== undefined) await this.recordBranchChange(tx, id, MasterDataAction.updated);
        return tx.location.findUniqueOrThrow({ where: { id }, select: LOCATION_SELECT });
      });
      return toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'LOCATION_CODE_TAKEN',
          `A location with code ${code} already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * The fix for a wrong code already in use: `dto.byLocationId`, a location of the same
   * type, takes over, and this one is deactivated with a link to it that a POS pulls.
   */
  async supersede(
    id: string,
    dto: SupersedeLocationDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<LocationView> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Both rows, locked in a fixed order so two opposite supersedes cannot deadlock.
      const [first, second] = [id, dto.byLocationId].sort();
      await this.lockLocation(tx, first);
      if (second !== first) await this.lockLocation(tx, second);
      const current = await this.lockLocation(tx, id);
      labelRequestLocation(current.code);
      const replacement = await this.lockLocation(tx, dto.byLocationId);
      this.assertRevision(current, dto.revision);

      const refused = supersedeProblem(current, replacement);
      if (refused) throw new BusinessRuleError(...SUPERSEDE_ERRORS[refused]);

      const version = current.type === 'branch' ? await this.masterData.nextVersion(tx) : undefined;
      const updated = await tx.location.update({
        where: { id },
        data: {
          active: false,
          supersededById: replacement.id,
          revision: { increment: 1 },
          masterDataVersion: version,
        },
        select: LOCATION_SELECT,
      });
      await this.followWithInTransit(tx, updated, actor, meta);
      await this.audit.recordWithin(tx, {
        ...byActor(actor, meta),
        action: AuditAction.UPDATE,
        entityType: 'Location',
        entityId: id,
        summary: `Superseded ${current.code} by ${replacement.code}`,
        changes: {
          active: { from: current.active, to: false },
          supersededBy: { from: null, to: { id: replacement.id, locationCode: replacement.code } },
        },
      });
      if (version !== undefined) await this.recordBranchChange(tx, id, MasterDataAction.updated);
      return tx.location.findUniqueOrThrow({ where: { id }, select: LOCATION_SELECT });
    });
    return toView(row);
  }

  /**
   * Fixes the codes of these locations: the first posted document that names a location,
   * or the first POS pull of a branch, calls this in its own transaction. Idempotent: a
   * location already in use keeps its first use.
   */
  async markFirstUse(tx: Tx, locationIds: string[], use: string): Promise<void> {
    if (locationIds.length === 0) return;
    await tx.location.updateMany({
      where: { id: { in: locationIds }, firstUsedAt: null },
      data: { firstUsedAt: new Date(), firstUse: use },
    });
  }

  private validCode(input: string): string {
    const code = normaliseLocationCode(input);
    const problem = locationCodeProblem(code);
    if (problem) {
      throw new BusinessRuleError(
        'INVALID_LOCATION_CODE',
        'A location code is 2–32 capital letters, digits or hyphens, starting with a letter or digit',
        { problem },
      );
    }
    return code;
  }

  private assertRevision(current: LocationRow, revision: number): void {
    if (current.revision !== revision) {
      throw new ConflictError(
        'LOCATION_CHANGED',
        'This location was changed by someone else since you opened it. Reload it and try again.',
        { currentRevision: current.revision },
      );
    }
  }

  /** A plant's or warehouse's in-transit location takes its code, names and active flag. */
  private async followWithInTransit(
    tx: Tx,
    origin: LocationRow,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<void> {
    if (!origin.inTransit) return;
    const inTransit = await this.lockLocation(tx, origin.inTransit.id);
    const next = {
      code: inTransitCode(origin.code),
      ...inTransitNames(origin.nameTh, origin.nameEn),
      active: origin.active,
    };
    const changes = diff(inTransit, next);
    if (Object.keys(changes).length === 0) return;
    await tx.location.update({
      where: { id: inTransit.id },
      data: { ...next, revision: { increment: 1 } },
    });
    await this.audit.recordWithin(tx, {
      ...byActor(actor, meta),
      action: AuditAction.UPDATE,
      entityType: 'Location',
      entityId: inTransit.id,
      summary: `Updated ${next.code} with ${origin.code}`,
      changes,
    });
  }

  /** Appends a branch's change at the version its row already carries. */
  private async recordBranchChange(tx: Tx, id: string, action: MasterDataAction): Promise<void> {
    const branch = await tx.location.findUniqueOrThrow({ where: { id }, select: LOCATION_SELECT });
    const version = branch.masterDataVersion!;
    await this.masterData.append(tx, version, {
      entityType: LOCATION_ENTITY,
      entityId: branch.id,
      entityCode: branch.code,
      action,
      data: { ...snapshot(branch), version: Number(version) },
    });
  }

  /** The row, locked for the rest of the transaction so concurrent edits queue up. */
  private async lockLocation(tx: Tx, id: string): Promise<LocationRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM locations WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (locked.length === 0) throw new NotFoundError('Location', id);
    return tx.location.findUniqueOrThrow({ where: { id }, select: LOCATION_SELECT });
  }
}

function inTransitNames(nameTh: string, nameEn: string) {
  return { nameTh: `ระหว่างขนส่งจาก ${nameTh}`, nameEn: `In transit from ${nameEn}` };
}

function byActor(actor: AuthenticatedUser, meta: ClientMeta) {
  return { actorUserId: actor.userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent };
}

const ref = (r: { id: string; code: string } | null) =>
  r ? { id: r.id, locationCode: r.code } : null;

/**
 * The location as a mirror or an auditor needs it. The code is spelled `locationCode`: the
 * audit trail redacts any field called `code`, and the change log reads the same way.
 */
function snapshot(row: LocationRow) {
  return {
    id: row.id,
    locationCode: row.code,
    type: row.type,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    active: row.active,
    supersededBy: ref(row.supersededBy),
  };
}

function toView(row: LocationRow): LocationView {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    active: row.active,
    origin: row.origin,
    inTransit: row.inTransit,
    supersededBy: row.supersededBy,
    firstUsedAt: row.firstUsedAt,
    firstUse: row.firstUse,
    revision: row.revision,
    masterDataVersion: row.masterDataVersion === null ? null : Number(row.masterDataVersion),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type Changes = Record<string, { from: unknown; to: unknown }>;

function diff(
  current: { code: string; nameTh: string; nameEn: string; active: boolean },
  next: { code?: string; nameTh?: string; nameEn?: string; active?: boolean },
): Changes {
  const changes: Changes = {};
  const fields = [
    ['code', 'locationCode'],
    ['nameTh', 'nameTh'],
    ['nameEn', 'nameEn'],
    ['active', 'active'],
  ] as const;
  for (const [field, key] of fields) {
    const to = next[field];
    if (to !== undefined && to !== current[field]) changes[key] = { from: current[field], to };
  }
  return changes;
}

function updateSummary(before: LocationRow, after: LocationRow, changes: Changes): string {
  const fields = Object.keys(changes);
  if (fields.length === 1 && changes.active) {
    return `${after.active ? 'Reactivated' : 'Deactivated'} ${after.type} ${after.code}`;
  }
  if (changes.locationCode) {
    return `Corrected the code of ${before.type} ${before.code} to ${after.code}`;
  }
  return `Updated ${after.type} ${after.code} (${after.nameEn})`;
}

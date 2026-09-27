// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BusinessRuleError,
  ConflictError,
  DomainError,
  NotFoundError,
} from '../../core/errors/domain.errors';
import type { ClientMeta } from '../../core/http/client-meta';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { MetricsService } from '../../core/telemetry/metrics.service';
import {
  labelRequestLocation,
  labelRequestPosInstance,
} from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { AuditAction, AuditService } from '../audit/audit.service';
import { LocationsService, type LocationFacts } from '../locations/locations.service';
import { MasterDataService, type MasterDataChangesView } from '../master-data/master-data.service';
import {
  bearerToken,
  CONTRACT_VERSION,
  CREDENTIAL_PREFIX,
  looksLikeCredential,
  registrationProblem,
  type RegistrationProblem,
} from './domain/pos-rules';
import type {
  ContractInstanceView,
  IssuedCredentialView,
  PosInstanceView,
  RegisterPosInstanceDto,
} from './dto/pos-integration.dto';

type Tx = Prisma.TransactionClient;

/** A POS instance as a request authenticated by its credential sees it. */
export interface AuthenticatedInstance {
  id: string;
  code: string;
  name: string;
  branches: LocationFacts[];
}

/** Why a credential was refused, and the instance it belonged to when that is known. */
export interface CredentialRefusal {
  reason: 'credential_revoked' | 'credential_unknown';
  posInstance?: string;
}

const REGISTRATION_ERRORS: Record<RegistrationProblem, string> = {
  CODE_INVALID: 'The code is 2–32 capital letters, digits or hyphens, starting with one of them',
  NAME_MISSING: 'Give the instance a name people will recognise',
  NAME_TOO_LONG: 'The name is at most 100 characters',
  NO_BRANCHES: 'Choose at least one branch the instance sells for',
  DUPLICATE_BRANCH: 'A branch is listed more than once',
};

const INSTANCE_INCLUDE = {
  createdBy: { select: { id: true, displayName: true } },
  branches: { select: { locationId: true } },
  credentials: {
    where: { revokedAt: null },
    select: { createdAt: true, createdBy: { select: { id: true, displayName: true } } },
  },
} satisfies Prisma.PosInstanceInclude;

type InstanceRow = Prisma.PosInstanceGetPayload<{ include: typeof INSTANCE_INCLUDE }>;

/** Only the SHA-256 of a credential is stored or compared. */
const hashOf = (credential: string) => createHash('sha256').update(credential).digest('hex');

/**
 * POS instances and their machine credentials (#9, ADR-0002, contracts/README.md). An admin
 * registers an instance with the branches it sells for and is shown its credential once; a new
 * one can be issued (the old one stops working) and the credential revoked, all audited. The
 * POS-facing side authenticates a credential, answers who the instance is, and serves the
 * master-data pull — logging and counting every refusal as an integration event, with the
 * instance's code on every line (docs/TELEMETRY.md "POS↔ERP integration lines").
 */
@Injectable()
export class PosInstancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly masterData: MasterDataService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
    metrics: MetricsService,
  ) {
    metrics.gaugeFromDatabase(
      'erp_master_data_last_pull_timestamp_seconds',
      'When each POS instance last pulled master data successfully (Unix seconds), read from the database.',
      ['pos_instance'],
      () => this.lastPulls(),
    );
  }

  // --- Administration -----------------------------------------------------------------

  async list(): Promise<PosInstanceView[]> {
    const rows = await this.prisma.posInstance.findMany({
      include: INSTANCE_INCLUDE,
      orderBy: { code: 'asc' },
    });
    const branches = await this.locations.describe(
      rows.flatMap((r) => r.branches.map((b) => b.locationId)),
    );
    return rows.map((row) => toView(row, branches));
  }

  async get(id: string): Promise<PosInstanceView> {
    const row = await this.prisma.posInstance.findUnique({
      where: { id },
      include: INSTANCE_INCLUDE,
    });
    if (!row) throw new NotFoundError('POS instance', id);
    labelRequestPosInstance(row.code);
    const branches = await this.locations.describe(row.branches.map((b) => b.locationId));
    return toView(row, branches);
  }

  /** Registers an instance for the given branches and issues its first credential. */
  async register(
    dto: RegisterPosInstanceDto,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<IssuedCredentialView> {
    const problem = registrationProblem(dto);
    if (problem) {
      throw new BusinessRuleError('INVALID_POS_INSTANCE', REGISTRATION_ERRORS[problem], {
        problem,
      });
    }
    const found = await this.locations.byCodes(dto.branchCodes);
    for (const code of dto.branchCodes) {
      const branch = found.get(code);
      if (!branch || branch.type !== 'branch') {
        throw new BusinessRuleError('UNKNOWN_BRANCH', `There is no branch with code ${code}`, {
          branchCode: code,
        });
      }
      if (!branch.active) {
        throw new BusinessRuleError('BRANCH_INACTIVE', `Branch ${code} is no longer in use`, {
          branchCode: code,
        });
      }
    }
    labelRequestPosInstance(dto.code);
    const credential = newCredential();
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const instance = await tx.posInstance.create({
          data: {
            code: dto.code,
            name: dto.name.trim(),
            createdById: actor.userId,
            branches: {
              create: dto.branchCodes.map((code) => ({ locationId: found.get(code)!.id })),
            },
          },
        });
        await tx.posCredential.create({
          data: {
            posInstanceId: instance.id,
            tokenHash: hashOf(credential),
            createdById: actor.userId,
          },
        });
        await this.audit.recordWithin(tx, {
          actorUserId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'PosInstance',
          entityId: instance.id,
          summary: `Registered POS instance ${instance.code} for ${dto.branchCodes.join(', ')}`,
          // `code` is a redacted field name in the audit trail (second-factor codes): say which code.
          changes: {
            instanceCode: instance.code,
            name: instance.name,
            branchCodes: dto.branchCodes,
          },
          ...meta,
        });
        return instance.id;
      });
      return { instance: await this.get(id), credential };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'POS_INSTANCE_CODE_TAKEN',
          `A POS instance with code ${dto.code} already exists`,
        );
      }
      throw error;
    }
  }

  /** Issues a new credential; the one in use, if any, stops working at the same moment. */
  async issueCredential(
    id: string,
    actor: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<IssuedCredentialView> {
    const credential = newCredential();
    await this.prisma.$transaction(async (tx) => {
      const instance = await this.lockInstance(tx, id);
      const revoked = await this.revokeActive(tx, instance.id, actor);
      await tx.posCredential.create({
        data: {
          posInstanceId: instance.id,
          tokenHash: hashOf(credential),
          createdById: actor.userId,
        },
      });
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'PosInstance',
        entityId: instance.id,
        summary: revoked
          ? `Issued a new credential to POS instance ${instance.code}; the previous one is revoked`
          : `Issued a new credential to POS instance ${instance.code}`,
        changes: { credential: revoked ? 'replaced' : 'issued' },
        ...meta,
      });
    });
    return { instance: await this.get(id), credential };
  }

  /** Revokes the credential in use: the POS is refused from its next request on. */
  async revoke(id: string, actor: AuthenticatedUser, meta: ClientMeta): Promise<PosInstanceView> {
    await this.prisma.$transaction(async (tx) => {
      const instance = await this.lockInstance(tx, id);
      if (!(await this.revokeActive(tx, instance.id, actor))) {
        throw new ConflictError(
          'NO_ACTIVE_CREDENTIAL',
          `POS instance ${instance.code} has no credential in use`,
        );
      }
      await this.audit.recordWithin(tx, {
        actorUserId: actor.userId,
        action: AuditAction.REVOKE,
        entityType: 'PosInstance',
        entityId: instance.id,
        summary: `Revoked the credential of POS instance ${instance.code}`,
        changes: { credential: 'revoked' },
        ...meta,
      });
    });
    return this.get(id);
  }

  // --- The POS side ---------------------------------------------------------------------

  /**
   * The instance a request's credential belongs to, or why it is refused. A revoked credential
   * still names its instance, so the refusal can be labelled with it; an unknown one cannot.
   * Nothing from the credential itself is ever logged.
   */
  async authenticate(
    authorization: string | undefined,
  ): Promise<{ instance: AuthenticatedInstance } | { refusal: CredentialRefusal }> {
    const token = bearerToken(authorization);
    if (!token || !looksLikeCredential(token)) {
      return { refusal: { reason: 'credential_unknown' } };
    }
    const row = await this.prisma.posCredential.findUnique({
      where: { tokenHash: hashOf(token) },
      select: {
        revokedAt: true,
        posInstance: {
          select: { id: true, code: true, name: true, branches: { select: { locationId: true } } },
        },
      },
    });
    if (!row) return { refusal: { reason: 'credential_unknown' } };
    labelRequestPosInstance(row.posInstance.code);
    if (row.revokedAt) {
      return { refusal: { reason: 'credential_revoked', posInstance: row.posInstance.code } };
    }
    const described = await this.locations.describe(
      row.posInstance.branches.map((b) => b.locationId),
    );
    const branches = [...described.values()].sort((a, b) => a.code.localeCompare(b.code));
    // A line about an instance that serves one branch concerns that branch.
    if (branches.length === 1) labelRequestLocation(branches[0].code);
    return {
      instance: {
        id: row.posInstance.id,
        code: row.posInstance.code,
        name: row.posInstance.name,
        branches,
      },
    };
  }

  /** `GET /pos/instance`: the contract's view of the credential's own instance. */
  async whoAmI(authorization: string | undefined): Promise<ContractInstanceView> {
    const result = await this.authenticate(authorization);
    if ('refusal' in result) {
      this.logger.write({
        severity: 'WARNING',
        event: 'app.log',
        message: `Refused a POS instance lookup: ${result.refusal.reason}`,
        labels: { reason: result.refusal.reason },
      });
      throw credentialRejected(result.refusal.reason);
    }
    const { instance } = result;
    return {
      code: instance.code,
      name: instance.name,
      contractVersion: CONTRACT_VERSION,
      branches: instance.branches.map((b) => ({
        code: b.code,
        nameTh: b.nameTh,
        nameEn: b.nameEn,
        active: b.active,
      })),
    };
  }

  /**
   * The master-data pull with a machine credential: the changes since a version, recorded as
   * the instance's last pull. A refused credential is logged with its reason, like a refused
   * sales event (docs/TELEMETRY.md), and answered with 401.
   */
  async pull(
    authorization: string | undefined,
    since: number,
    limit: number,
  ): Promise<MasterDataChangesView> {
    const result = await this.authenticate(authorization);
    if ('refusal' in result) {
      this.logger.write({
        severity: 'WARNING',
        event: 'master_data.pull_refused',
        message: `Refused a master-data pull: ${result.refusal.reason}`,
        labels: { reason: result.refusal.reason },
      });
      throw credentialRejected(result.refusal.reason);
    }
    const page = await this.masterData.changesSince(since, limit);
    await this.prisma.posInstance.update({
      where: { id: result.instance.id },
      data: { lastPullAt: new Date() },
    });
    const last = page.changes.at(-1)?.version ?? since;
    this.logger.write({
      severity: 'INFO',
      event: 'master_data.pulled',
      message: `Pulled ${page.changes.length} master-data changes after version ${since}, up to ${last} of ${page.latestVersion}`,
    });
    return page;
  }

  // --- Internals ------------------------------------------------------------------------

  private async lockInstance(tx: Tx, id: string): Promise<{ id: string; code: string }> {
    const rows = await tx.$queryRaw<{ id: string; code: string }[]>`
      SELECT "id", "code" FROM "pos_instances" WHERE "id" = ${id}::uuid FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundError('POS instance', id);
    labelRequestPosInstance(rows[0].code);
    return rows[0];
  }

  /** Revokes the instance's active credential, if any; true when there was one. */
  private async revokeActive(tx: Tx, instanceId: string, actor: AuthenticatedUser) {
    const { count } = await tx.posCredential.updateMany({
      where: { posInstanceId: instanceId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actor.userId },
    });
    return count > 0;
  }

  private async lastPulls(): Promise<Array<{ labels: { pos_instance: string }; value: number }>> {
    const rows = await this.prisma.posInstance.findMany({
      where: { lastPullAt: { not: null } },
      select: { code: true, lastPullAt: true },
    });
    return rows.map((row) => ({
      labels: { pos_instance: row.code },
      value: row.lastPullAt!.getTime() / 1000,
    }));
  }
}

/** A new credential: the prefix and 32 random bytes. Shown once, stored only as a hash. */
function newCredential(): string {
  return `${CREDENTIAL_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function credentialRejected(reason: CredentialRefusal['reason']): DomainError {
  return new DomainError(
    'POS_CREDENTIAL_REJECTED',
    reason === 'credential_revoked'
      ? 'This POS credential has been revoked. Ask an administrator for a new one.'
      : 'The ERP does not recognise this POS credential.',
    HttpStatus.UNAUTHORIZED,
    { reason },
  );
}

function toView(row: InstanceRow, branches: Map<string, LocationFacts>): PosInstanceView {
  const active = row.credentials[0];
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    branches: row.branches
      .map((b) => branches.get(b.locationId)!)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((b) => ({
        id: b.id,
        code: b.code,
        nameTh: b.nameTh,
        nameEn: b.nameEn,
        active: b.active,
      })),
    credential: active ? { issuedAt: active.createdAt, issuedBy: active.createdBy } : null,
    lastPullAt: row.lastPullAt,
  };
}

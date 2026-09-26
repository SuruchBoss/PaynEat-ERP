// Adapted from Cwork (backend/src/modules/audit/audit.service.ts), see NOTICE. The
// correlation id is taken from the request context rather than passed by every caller,
// and there is a transactional variant for changes that must not exist without their entry.
import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { pageOf, type Page } from '../../core/http/pagination.dto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { currentRequestContext } from '../../core/telemetry/request-context';
import { GENERIC_EVENT, TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import type { AuditQueryDto } from './dto/audit-query.dto';

export { AuditAction };

export interface AuditEntry {
  actorUserId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  changes?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogView {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  createdAt: Date;
  actor: { id: string; email: string; displayName: string } | null;
}

/** Field names whose values must never reach the audit table in cleartext. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'code',
  'mfaSecretEnc',
  'mfaRecoveryCodes',
  'recoveryCodes',
  'secret',
  'token',
  'tokenHash',
  'refreshToken',
  'accessToken',
  'challengeToken',
]);

type Writer = Pick<Prisma.TransactionClient, 'auditLog'>;

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: TelemetryLogger,
  ) {}

  /**
   * Records an entry outside any transaction. Auditing must never break the operation
   * it is recording (a sign-in, a sign-out), so a failure here is logged and swallowed.
   * (Cwork.)
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.write(this.prisma, entry);
    } catch (error) {
      this.logger.write({
        severity: 'ERROR',
        event: GENERIC_EVENT,
        message: `Failed to write the audit entry ${entry.action} ${entry.entityType}`,
        error,
      });
    }
  }

  /**
   * Records an entry inside the caller's transaction, for a change that must not exist
   * without its entry (a user created, a role granted or revoked): both commit, or
   * neither does. Errors propagate and roll the change back.
   */
  async recordWithin(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await this.write(tx, entry);
  }

  /** Browsing the trail. One `where` for the page and the count, so they always agree. */
  async search(query: AuditQueryDto): Promise<Page<AuditLogView>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
        skip: query.skip,
        take: query.limit,
        include: { actor: { select: { id: true, email: true, displayName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return pageOf(
      data.map(({ actorUserId: _actorUserId, ...row }) => row),
      total,
      query.page,
      query.limit,
    );
  }

  private async write(client: Writer, entry: AuditEntry): Promise<void> {
    await client.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary ?? null,
        changes: entry.changes ? (redact(entry.changes) as Prisma.InputJsonValue) : Prisma.DbNull,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent?.slice(0, 500) ?? null,
        correlationId: currentRequestContext()?.correlationId ?? null,
      },
    });
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_FIELDS.has(key) ? '[redacted]' : redact(val);
    }
    return out;
  }
  return value;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type SalesEventStatus } from '@prisma/client';
import { DomainError } from '../../core/errors/domain.errors';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MetricsService } from '../../core/telemetry/metrics.service';
import { labelRequestLocation } from '../../core/telemetry/request-context';
import { TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import {
  checkSalesEvent,
  type SchemaError,
  type SalesEventV1,
} from './contract/sales-event-schema';
import {
  canonicalJson,
  IDEMPOTENCY_KEY_PATTERN,
  salesEventRefusal,
  type SalesEventReason,
} from './domain/pos-rules';
import type { SalesEventReceipt } from './dto/pos-integration.dto';
import { credentialRejected, PosInstancesService } from './pos-instances.service';

const REJECTION_MESSAGES: Record<Exclude<SalesEventReason, `credential_${string}`>, string> = {
  schema_invalid: 'The sales event does not match sales event schema v1',
  pos_instance_mismatch: "The sales event names another POS instance than the credential's own",
  branch_not_served: 'This POS instance does not sell for that branch',
  idempotency_key_reused:
    'This idempotency key was already used for a different sale line; a key is never reused',
};

type Tx = Prisma.TransactionClient | PrismaService;

/** A stored sales event, as branch consumption (#17) reads it. */
export interface StoredSalesEvent {
  id: string;
  idempotencyKey: string;
  posInstanceCode: string;
  locationId: string;
  locationCode: string;
  saleTime: Date;
  receivedAt: Date;
  menuItemCode: string;
  quantity: string | null;
  weightKg: string | null;
  modifiers: Array<{ code: string; quantity: string }>;
  status: SalesEventStatus;
}

/**
 * Sales-event ingest (#9, contracts/pos/v1): a paid sale line from a POS, stored exactly once by
 * its idempotency key. The checks follow contracts/README.md in order — credential, schema, the
 * instance, the branch, a reused key — and every refusal is a `sales_event.rejected` line with its
 * `reason`, counted in `erp_sales_events_total`, never a bare 401 or 422. The idempotency key is
 * the correlation id of every line about the event (docs/TELEMETRY.md).
 *
 * Exactly once, however many copies arrive together: the insert is `ON CONFLICT DO NOTHING` on
 * the unique key, so one copy stores the event and every other finds it and answers "duplicate".
 */
@Injectable()
export class SalesEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instances: PosInstancesService,
    private readonly logger: TelemetryLogger,
    private readonly metrics: MetricsService,
  ) {
    // Branch consumption's backlog (#17, docs/TELEMETRY.md), read from the database at scrape.
    metrics.gaugeFromDatabase(
      'erp_sales_events_unprocessed',
      'Sales events not yet branch consumption (received, waiting, held or failed), per branch.',
      ['location_code'],
      async () =>
        (await this.unprocessedByBranch()).map((row) => ({
          labels: { location_code: row.locationCode },
          value: row.count,
        })),
    );
    metrics.gaugeFromDatabase(
      'erp_sales_events_oldest_unprocessed_age_seconds',
      'Seconds since the ERP received the oldest sales event not yet branch consumption, per branch.',
      ['location_code'],
      async () =>
        (await this.unprocessedByBranch()).map((row) => ({
          labels: { location_code: row.locationCode },
          value: row.oldestAgeSeconds,
        })),
    );
  }

  async ingest(
    authorization: string | undefined,
    body: unknown,
  ): Promise<{ created: boolean; receipt: SalesEventReceipt }> {
    const key = keyOf(body);

    const auth = await this.instances.authenticate(authorization);
    if ('refusal' in auth) {
      this.reject(auth.refusal.reason, key);
      throw credentialRejected(auth.refusal.reason);
    }
    const { instance } = auth;

    const checked = checkSalesEvent(body);
    if (!checked.ok) throw this.refuse('schema_invalid', key, checked.errors);
    const event = checked.event;
    labelRequestLocation(event.branchCode);

    const refusal = salesEventRefusal(event, {
      code: instance.code,
      branchCodes: instance.branches.map((b) => b.code),
    });
    if (refusal) throw this.refuse(refusal, key);
    const branch = instance.branches.find((b) => b.code === event.branchCode)!;

    const payloadHash = createHash('sha256').update(canonicalJson(event)).digest('hex');
    const inserted = await this.prisma.$queryRaw<{ receivedAt: Date }[]>`
      INSERT INTO "sales_events"
        ("id", "idempotency_key", "pos_instance_id", "location_id", "sale_time", "menu_item_code",
         "quantity", "weight_kg", "modifiers", "payload", "payload_hash")
      VALUES
        (gen_random_uuid(), ${event.idempotencyKey}, ${instance.id}::uuid, ${branch.id}::uuid,
         ${event.saleTime}::timestamptz, ${event.menuItemCode}, ${event.quantity ?? null}::numeric,
         ${event.weightKg ?? null}::numeric, ${JSON.stringify(event.modifiers)}::jsonb,
         ${JSON.stringify(event)}::jsonb, ${payloadHash})
      ON CONFLICT ("idempotency_key") DO NOTHING
      RETURNING "received_at" AS "receivedAt"
    `;
    if (inserted.length === 1) {
      this.write(
        'INFO',
        'sales_event.received',
        `Received sales event ${event.idempotencyKey}`,
        key,
      );
      this.metrics.countSalesEvent('received');
      return { created: true, receipt: receipt(event, 'received', false, inserted[0].receivedAt) };
    }

    const stored = await this.prisma.salesEvent.findUniqueOrThrow({
      where: { idempotencyKey: event.idempotencyKey },
      select: { payloadHash: true, status: true, receivedAt: true, posInstanceId: true },
    });
    if (stored.payloadHash !== payloadHash || stored.posInstanceId !== instance.id) {
      throw this.refuse('idempotency_key_reused', key);
    }
    this.write(
      'INFO',
      'sales_event.duplicate',
      `Sales event ${event.idempotencyKey} was already received; nothing stored again`,
      key,
    );
    this.metrics.countSalesEvent('duplicate');
    return { created: false, receipt: receipt(event, stored.status, true, stored.receivedAt) };
  }

  // --- For branch consumption (#17) ---------------------------------------------------

  /**
   * The ids of events still `received`, oldest first, leaving out `excluding` (events held for
   * a person). Nothing is locked: each is then claimed with `lock`.
   */
  async waitingIds(limit: number, excluding: readonly string[] = []): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "sales_events"
      WHERE "status" = 'received' AND NOT ("id" = ANY(${[...excluding]}::uuid[]))
      ORDER BY "received_at", "id"
      LIMIT ${limit}
    `;
    return rows.map((row) => row.id);
  }

  /**
   * Locks one event for the rest of the transaction when it is in one of `statuses`. With
   * `skipLocked`, an event another transaction holds reads as absent, so two processors never
   * work on the same event at once; without it, the caller waits its turn.
   */
  async lock(
    tx: Tx,
    id: string,
    statuses: readonly SalesEventStatus[],
    skipLocked: boolean,
  ): Promise<StoredSalesEvent | null> {
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "sales_events"
      WHERE "id" = ${id}::uuid AND "status"::text = ANY(${[...statuses]}::text[])
      FOR UPDATE ${skipLocked ? Prisma.sql`SKIP LOCKED` : Prisma.empty}
    `;
    if (ids.length === 0) return null;
    return (await this.describe([id], tx)).get(id) ?? null;
  }

  /** These events, keyed by id; unknown ids are absent. */
  async describe(
    ids: readonly string[],
    tx: Tx = this.prisma,
  ): Promise<Map<string, StoredSalesEvent>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.salesEvent.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        idempotencyKey: true,
        posInstance: { select: { code: true } },
        locationId: true,
        location: { select: { code: true } },
        saleTime: true,
        receivedAt: true,
        menuItemCode: true,
        quantity: true,
        weightKg: true,
        modifiers: true,
        status: true,
      },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          idempotencyKey: row.idempotencyKey,
          posInstanceCode: row.posInstance.code,
          locationId: row.locationId,
          locationCode: row.location.code,
          saleTime: row.saleTime,
          receivedAt: row.receivedAt,
          menuItemCode: row.menuItemCode,
          quantity: row.quantity === null ? null : row.quantity.toFixed(),
          weightKg: row.weightKg === null ? null : row.weightKg.toFixed(),
          modifiers: row.modifiers as StoredSalesEvent['modifiers'],
          status: row.status,
        },
      ]),
    );
  }

  /**
   * Moves a locked event to `status`. The database lets it become `processed` only once its
   * branch consumption is posted, and never lets it leave `processed`.
   */
  async setStatus(tx: Tx, id: string, status: SalesEventStatus): Promise<void> {
    await tx.salesEvent.update({ where: { id }, data: { status } });
  }

  /**
   * Per branch, the events not yet processed (received, waiting or held, and failed) and how
   * long the oldest of them has waited since the ERP received it, for the gauges of #17.
   */
  async unprocessedByBranch(): Promise<
    Array<{ locationCode: string; count: number; oldestAgeSeconds: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ locationCode: string; count: bigint; oldestAgeSeconds: number }>
    >`
      SELECT l."code" AS "locationCode", COUNT(*) AS "count",
             EXTRACT(EPOCH FROM (now() - MIN(e."received_at")))::float8 AS "oldestAgeSeconds"
      FROM "sales_events" e
      JOIN "locations" l ON l."id" = e."location_id"
      WHERE e."status" <> 'processed'
      GROUP BY l."code"
      ORDER BY l."code"
    `;
    return rows.map((row) => ({
      locationCode: row.locationCode,
      count: Number(row.count),
      oldestAgeSeconds: row.oldestAgeSeconds,
    }));
  }

  /** A refusal after the credential: logged and counted, answered with 422. */
  private refuse(
    reason: Exclude<SalesEventReason, `credential_${string}`>,
    key: string | undefined,
    errors?: SchemaError[],
  ): DomainError {
    this.reject(reason, key);
    return new DomainError(
      'SALES_EVENT_REJECTED',
      REJECTION_MESSAGES[reason],
      HttpStatus.UNPROCESSABLE_ENTITY,
      errors ? { reason, errors } : { reason },
    );
  }

  private reject(reason: SalesEventReason, key: string | undefined): void {
    this.write(
      'WARNING',
      'sales_event.rejected',
      `Refused sales event ${key ?? '(without a usable idempotency key)'}: ${reason}`,
      key,
      reason,
    );
    this.metrics.countSalesEvent('rejected', reason);
  }

  private write(
    severity: 'INFO' | 'WARNING',
    event: string,
    message: string,
    key: string | undefined,
    reason?: SalesEventReason,
  ): void {
    this.logger.write({
      severity,
      event,
      message,
      ...(reason ? { labels: { reason } } : {}),
      // The idempotency key is the event's correlation id; without a usable one, the
      // request's own x-request-id stands in.
      ...(key ? { correlationId: key } : {}),
    });
  }
}

/** The body's idempotency key when it has the shape of one, whatever else is wrong. */
function keyOf(body: unknown): string | undefined {
  const key = (body as { idempotencyKey?: unknown } | null)?.idempotencyKey;
  return typeof key === 'string' && IDEMPOTENCY_KEY_PATTERN.test(key) ? key : undefined;
}

function receipt(
  event: SalesEventV1,
  status: SalesEventReceipt['status'],
  duplicate: boolean,
  receivedAt: Date,
): SalesEventReceipt {
  return { idempotencyKey: event.idempotencyKey, status, duplicate, receivedAt };
}

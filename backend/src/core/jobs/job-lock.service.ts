// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/modules/jobs/job-lock.service.ts), see NOTICE.
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG } from '../config/config.token';
import type { RootConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { GENERIC_EVENT, TelemetryLogger } from '../telemetry/telemetry-logger';
import { JOB_LOCK_NAMESPACE, lockIdFor, type JobName } from './job-locks';

export type JobLockOutcome = 'ran' | 'skipped' | 'failed';

/** Prisma's code for an interactive transaction that outlived its timeout. */
const TRANSACTION_EXPIRED = 'P2028';

/**
 * Runs scheduled work on one instance at a time. Every replica of the API runs the same timers;
 * the lock keeps the work to one of them.
 *
 * The lock is a PostgreSQL transaction-scoped advisory lock: no table, no lease to renew, nothing
 * to clean up. An instance killed mid-run loses its connection, PostgreSQL rolls the transaction
 * back, and the lock is gone. The transaction only holds the lock: the work's own writes go
 * through other connections and commit on their own, so work that must be atomic still says so
 * itself. `JOB_LOCK_TIMEOUT_MS` bounds how long it holds a connection open.
 */
@Injectable()
export class JobLockService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: RootConfig,
    private readonly logger: TelemetryLogger,
  ) {}

  /**
   * Runs `work` if this instance can take `name`'s lock, and nothing at all if another holds it.
   * Never throws: a timer has nobody to report to, so a failure is logged and returned.
   */
  async runExclusively(name: JobName, work: () => Promise<unknown>): Promise<JobLockOutcome> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${JOB_LOCK_NAMESPACE}::int, ${lockIdFor(name)}::int)
              AS "locked"
          `;
          // Never waits: a skipped run is the expected outcome on every instance but one.
          if (rows[0]?.locked !== true) return 'skipped';
          await work();
          return 'ran';
        },
        { timeout: this.config.jobs.lockTimeoutMs, maxWait: 10_000 },
      );
    } catch (error) {
      const expired =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === TRANSACTION_EXPIRED;
      this.logger.write({
        severity: 'ERROR',
        event: GENERIC_EVENT,
        message: expired
          ? `Job ${name} ran past JOB_LOCK_TIMEOUT_MS (${this.config.jobs.lockTimeoutMs} ms) and lost its lock while still working`
          : `Job ${name} failed; its next run tries again`,
        error,
      });
      return 'failed';
    }
  }
}

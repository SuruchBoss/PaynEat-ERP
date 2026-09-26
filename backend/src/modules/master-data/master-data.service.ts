// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import { MasterDataAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { MasterDataChangesView } from './dto/master-data.dto';

export interface MasterDataChange {
  entityType: string;
  entityId: string;
  entityCode: string;
  action: MasterDataAction;
  data: Prisma.InputJsonValue;
}

/**
 * The master data change log (ADR-0002): every create and update of master data takes
 * the next company-wide version and appends one change, in the writer's own transaction.
 * A POS instance pulls every change after the last version it applied, so one that was
 * offline for a day simply catches up.
 *
 * Why the versions can be trusted:
 *  - The counter is one row, bumped with UPDATE ... RETURNING. The row lock that takes
 *    is held until the writer commits, so the next writer waits for it: versions are
 *    handed out and committed in the same order, with no gaps and no duplicates.
 *  - A reader therefore never sees version N+1 without N, and reads the counter and the
 *    changes in one REPEATABLE READ snapshot, so `latestVersion` and the changes agree.
 * The price is that master data writes are serialised company-wide, which is right for
 * data an administrator edits by hand.
 */
@Injectable()
export class MasterDataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Takes the next version and appends the change, inside `tx`. Call it after the
   * record's own validation, as late in the transaction as it can be: the counter stays
   * locked until commit. Returns the version, which the record stores as its own.
   */
  async nextVersion(tx: Prisma.TransactionClient): Promise<bigint> {
    // An upsert rather than a plain UPDATE, so the counter also starts itself on a
    // database whose tables were emptied (the e2e suite truncates everything).
    const [row] = await tx.$queryRaw<{ version: bigint }[]>`
      INSERT INTO master_data_version (id, version) VALUES (1, 1)
      ON CONFLICT (id) DO UPDATE SET version = master_data_version.version + 1
      RETURNING version
    `;
    return row.version;
  }

  /** Appends the change for a version `nextVersion` handed out in the same `tx`. */
  async append(
    tx: Prisma.TransactionClient,
    version: bigint,
    change: MasterDataChange,
  ): Promise<void> {
    await tx.masterDataChange.create({ data: { version, ...change } });
  }

  async changesSince(since: number, limit: number): Promise<MasterDataChangesView> {
    return this.prisma.$transaction(
      async (tx) => {
        const counter = await tx.masterDataVersion.findUnique({ where: { id: 1 } });
        const latest = counter?.version ?? 0n;
        const rows = await tx.masterDataChange.findMany({
          where: { version: { gt: BigInt(since), lte: latest } },
          orderBy: { version: 'asc' },
          take: limit + 1,
        });
        return {
          latestVersion: Number(latest),
          changes: rows.slice(0, limit).map((row) => ({
            version: Number(row.version),
            entityType: row.entityType,
            entityId: row.entityId,
            entityCode: row.entityCode,
            action: row.action,
            data: row.data,
            changedAt: row.changedAt,
          })),
          hasMore: rows.length > limit,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

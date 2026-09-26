// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/utils/sequence.service.ts), see NOTICE. One company per
// installation, so no organisation; and the number is taken inside the caller's transaction,
// so it has no gaps (Cwork's is gap-tolerant because it runs on its own).
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type SequenceScope = 'OPENING_BALANCE' | 'REVERSAL';

const PREFIXES: Record<SequenceScope, string> = {
  OPENING_BALANCE: 'OB',
  REVERSAL: 'RV',
};

/**
 * Allocates human-readable document numbers: OB-2026-00001, RV-2026-00001.
 *
 * The allocation is one atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so two
 * concurrent requests can never be handed the same number. It runs in the transaction that
 * creates the document: the counter row stays locked until that transaction ends, and a
 * rollback returns the number, so the numbers that exist have no gaps.
 */
@Injectable()
export class SequenceService {
  async next(tx: Prisma.TransactionClient, scope: SequenceScope, year: number): Promise<string> {
    const key = `${scope}:${year}`;
    const prefix = PREFIXES[scope];

    const rows = await tx.$queryRaw<{ nextValue: number; padding: number }[]>`
      INSERT INTO "number_sequences" ("key", "prefix", "next_value", "padding", "updated_at")
      VALUES (${key}, ${prefix}, 2, 5, now())
      ON CONFLICT ("key")
      DO UPDATE SET "next_value" = "number_sequences"."next_value" + 1, "updated_at" = now()
      RETURNING "next_value" - 1 AS "nextValue", "padding"
    `;

    const { nextValue, padding } = rows[0];
    return `${prefix}-${year}-${String(nextValue).padStart(padding, '0')}`;
  }
}

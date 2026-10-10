// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import type { Prisma, SalesEventStatus } from '@prisma/client';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { SalesEventsService, type StoredSalesEvent } from './sales-events.service';

export type { StoredSalesEvent } from './sales-events.service';

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * What other modules may ask of the sales events the POS delivered (ADR-0010): branch
 * consumption (#17) claims them, reads them and moves their status. Nothing else writes them.
 */
@Injectable()
export class PosIntegrationService {
  constructor(private readonly salesEvents: SalesEventsService) {}

  /** The ids of events still received, oldest first, leaving out `excluding`. */
  waitingSalesEventIds(limit: number, excluding: readonly string[] = []): Promise<string[]> {
    return this.salesEvents.waitingIds(limit, excluding);
  }

  /** Locks one event in one of `statuses` for the rest of the transaction, or null. */
  lockSalesEvent(
    tx: Tx,
    id: string,
    statuses: readonly SalesEventStatus[],
    skipLocked: boolean,
  ): Promise<StoredSalesEvent | null> {
    return this.salesEvents.lock(tx, id, statuses, skipLocked);
  }

  describeSalesEvents(ids: readonly string[], tx?: Tx): Promise<Map<string, StoredSalesEvent>> {
    return this.salesEvents.describe(ids, tx);
  }

  setSalesEventStatus(tx: Tx, id: string, status: SalesEventStatus): Promise<void> {
    return this.salesEvents.setStatus(tx, id, status);
  }
}

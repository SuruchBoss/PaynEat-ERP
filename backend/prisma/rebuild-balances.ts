// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Rebuilds the stock balance snapshot from the ledger, which wins on any disagreement
 * (ADR-0003). Postings wait while it runs; nothing else changes.
 *
 *     npm run ledger:rebuild-balances                                   # in backend/
 *     docker compose run --rm migrate npm run ledger:rebuild-balances   # with docker compose
 *
 * It first lists every balance that disagreed with the ledger, so a difference is seen before
 * it is corrected. Safe to run at any time and any number of times.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ledgerServices } from './ledger-services';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const { ledger } = ledgerServices(prisma);
    const differences = await ledger.compareBalances();
    for (const d of differences) {
      console.log(
        `  lot ${d.lotId} at ${d.locationId}: snapshot ${d.snapshot.quantity ?? 'none'}, ledger ${d.ledger.quantity ?? 'none'}`,
      );
    }
    const { balances, corrected } = await ledger.rebuildBalances();
    console.log(
      corrected === 0
        ? `Balances agreed with the ledger; rebuilt ${balances} balances.`
        : `Rebuilt ${balances} balances from the ledger; ${corrected} had disagreed and are corrected.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

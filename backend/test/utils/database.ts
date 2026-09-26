// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The destructive operations the end-to-end suite needs: empty the database and put
 * the demo chain back. Adapted from Cwork (backend/test/utils/database.ts), see NOTICE.
 */
import { execFileSync } from 'node:child_process';

const TEST_DB_HINT = /test/i;

/**
 * The database the suite is allowed to destroy.
 *
 * It must be named like a test database (`payneat_erp_test`), whichever variable it
 * comes from: losing a developer's local data to a test run is a bad afternoon.
 * `E2E_ALLOW_NON_TEST_DB=1` is the explicit, deliberate override.
 */
export function resolveDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('e2e needs a database: set E2E_DATABASE_URL (preferred) or DATABASE_URL.');
  }

  const name = new URL(url).pathname.replace(/^\//, '');
  if (!TEST_DB_HINT.test(name) && process.env.E2E_ALLOW_NON_TEST_DB !== '1') {
    throw new Error(
      `Refusing to wipe "${name}": it is not marked as a test database (its name has no "test").\n` +
        'Point E2E_DATABASE_URL at a throwaway database such as payneat_erp_test, or set ' +
        'E2E_ALLOW_NON_TEST_DB=1 if you really mean to truncate this one.',
    );
  }
  return url;
}

/** Every table Prisma owns, minus its own migration bookkeeping. */
export async function truncateAll(databaseUrl = resolveDatabaseUrl()): Promise<void> {
  // Imported lazily so a misconfigured URL fails the check above first.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
    `;
    if (tables.length === 0) return;

    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    // TRUNCATE rather than DELETE: from #7 the ledger tables refuse DELETE, and rightly so.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  } finally {
    await prisma.$disconnect();
  }
}

/** Builds the fictional fried-chicken chain with the same command a person runs. */
export function seedDemoChain(databaseUrl = resolveDatabaseUrl()): void {
  execFileSync('npx', ['ts-node', '--transpile-only', 'prisma/seed.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

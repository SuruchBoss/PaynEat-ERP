// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Prepares the database the e2e suite runs against, once, before any spec:
 * migrate, wipe (refusing a database not marked as a test database), seed.
 * Adapted from Cwork (backend/test/global-setup.ts), see NOTICE.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { resolveDatabaseUrl, seedDemoChain, truncateAll } from './utils/database';

export default async function globalSetup(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl();

  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  // Every app the suite boots binds its metrics listener to a free port.
  process.env.METRICS_PORT = '0';
  // Test-only secrets, used when the environment does not bring its own. They sign and
  // encrypt nothing outside this throwaway database.
  process.env.JWT_ACCESS_SECRET ??= 'e2e-only-access-secret-0123456789abcdefghij';
  process.env.JWT_REFRESH_SECRET ??= 'e2e-only-refresh-secret-0123456789abcdefghij';
  process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 0xe2).toString('base64');
  // The suite signs in far more often than any person; the limits themselves are
  // tested by booting an app with a low one (auth.e2e-spec.ts).
  process.env.THROTTLE_LIMIT = '100000';
  process.env.AUTH_THROTTLE_LIMIT = '100000';
  // On purpose: the suite seeds the demo chain and signs in with its accounts, which only
  // a demo installation allows (#5). Specs that test the refusals boot with ERP_DEMO=0.
  process.env.ERP_DEMO = '1';

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  await truncateAll(databaseUrl);
  seedDemoChain(databaseUrl);
}

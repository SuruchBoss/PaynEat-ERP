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

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  await truncateAll(databaseUrl);
  seedDemoChain(databaseUrl);
}

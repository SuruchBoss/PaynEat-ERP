// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The demo installation rules of #5, end to end: the demo seed's accounts have a
 * published password, so the seed runs only with ERP_DEMO=1 and never in production, a
 * production API refuses to start while one is enabled without the flag, and their
 * sign-in (and any session they already hold) is refused without it.
 */
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { DEMO_PASSWORD } from '../prisma/seed';
import {
  API,
  bearer,
  demoEmail,
  signIn,
  signInAsAdmin,
  TEST_PASSWORD,
  uniqueEmail,
  type Session,
} from './utils/auth';
import { resolveDatabaseUrl, seedDemoChain } from './utils/database';
import { createTestApp, type LogLine, TestAppStartError, type TestContext } from './utils/test-app';

/** What a production start needs besides the suite's own environment. */
const PRODUCTION = { NODE_ENV: 'production', CORS_ORIGINS: 'http://localhost:8180' };

const appLog = (lines: LogLine[], severity: string): LogLine[] =>
  lines.filter((l) => l.labels?.event === 'app.log' && l.severity === severity);

/** Runs a backend npm script against the test database; returns its exit code and output. */
function runScript(script: string, env: Record<string, string | undefined>) {
  try {
    const stdout = execFileSync('npm', ['run', '--silent', script], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: resolveDatabaseUrl(), ...env },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

describe('demo installation (ERP_DEMO)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('the demo seed', () => {
    it('refuses to run without ERP_DEMO=1, and writes nothing', async () => {
      const before = await prisma.user.count();
      const result = runScript('db:seed', { ERP_DEMO: undefined, NODE_ENV: 'development' });

      expect(result.status).toBe(1);
      expect(result.output).toContain('Seed refused.');
      expect(result.output).toContain('ERP_DEMO is not 1');
      expect(await prisma.user.count()).toBe(before);
    });

    it('refuses to run under NODE_ENV=production, even with ERP_DEMO=1', () => {
      const result = runScript('db:seed', { ERP_DEMO: '1', NODE_ENV: 'production' });

      expect(result.status).toBe(1);
      expect(result.output).toContain('NODE_ENV is production');
    });

    it('marks every account it creates as a demo account', async () => {
      const users = await prisma.user.findMany({
        where: { email: { endsWith: '@demo-chicken.example' } },
        select: { demo: true },
      });
      expect(users).toHaveLength(7);
      expect(users.every((u) => u.demo)).toBe(true);
    });
  });

  describe('a production API without ERP_DEMO=1', () => {
    it('refuses to start while demo accounts are enabled, saying how to fix it in one line', async () => {
      const refused = await createTestApp({ env: { ...PRODUCTION, ERP_DEMO: '0' } }).catch(
        (error: unknown) => error,
      );

      expect(refused).toBeInstanceOf(TestAppStartError);
      const [critical, ...more] = appLog((refused as TestAppStartError).logs(), 'CRITICAL');
      expect(more).toHaveLength(0);
      expect(critical.message).toMatch(/^Refusing to start: 7 demo accounts with a published/);
      expect(critical.message).toContain('docker compose run --rm migrate npm run demo:disable');
      expect(critical.message).toContain('npm run demo:disable');
      expect(critical.message).toContain('set ERP_DEMO=1');
      expect(critical.message).not.toContain('\n');
      // Never names the accounts: no email in a log line.
      expect(critical.message).not.toMatch(/@/);
    });

    it('starts once `npm run demo:disable` has disabled them, which ends their sessions', async () => {
      const demoApp = await createTestApp();
      const purchasing = await signIn(demoApp.server, demoEmail('purchasing'));
      await demoApp.close();

      try {
        const result = runScript('demo:disable', {});
        expect(result.status).toBe(0);
        expect(result.output).toContain('Disabled 7 demo accounts and ended their sessions.');
        expect(runScript('demo:disable', {}).output).toContain('No enabled demo accounts');

        const accounts = await prisma.user.findMany({ where: { demo: true } });
        expect(accounts.map((a) => a.status)).toEqual(Array(7).fill('DISABLED'));
        const open = await prisma.session.count({
          where: { userId: { in: accounts.map((a) => a.id) }, revokedAt: null },
        });
        expect(open).toBe(0);
        const audit = await prisma.auditLog.count({
          where: { entityId: purchasing.user.id, summary: { startsWith: 'Demo account disabled' } },
        });
        expect(audit).toBe(1);

        const production = await createTestApp({ env: { ...PRODUCTION, ERP_DEMO: '0' } });
        try {
          expect(appLog(production.logs(), 'CRITICAL')).toHaveLength(0);
          expect(appLog(production.logs(), 'WARNING')).toHaveLength(0);
          const res = await request(production.server).get(`${API}/installation`);
          expect(res.body).toEqual({ demo: false });
        } finally {
          await production.close();
        }
      } finally {
        // The rest of the suite signs in with them: running the seed again turns them back on.
        seedDemoChain();
      }
    });
  });

  describe('a production API with ERP_DEMO=1', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await createTestApp({ env: { ...PRODUCTION, ERP_DEMO: '1' } });
    });
    afterAll(async () => {
      await ctx.close();
    });

    it('starts, and says it is a demo installation at every start', async () => {
      const [warning, ...more] = appLog(ctx.logs(), 'WARNING');
      expect(more).toHaveLength(0);
      expect(warning.message).toMatch(/^Demo installation \(ERP_DEMO=1\)/);
      expect(warning.message).toContain('published passwords');
    });

    it('tells the console to show the demo banner', async () => {
      const res = await request(ctx.server).get(`${API}/installation`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ demo: true });
    });

    it('lets the demo accounts sign in', async () => {
      const session = await signIn(ctx.server, demoEmail('finance'));
      expect(session.user.email).toBe(demoEmail('finance'));
    });
  });

  describe('an API without ERP_DEMO=1', () => {
    let ctx: TestContext;
    /** A session the demo account `plant` opened while the installation was a demo. */
    let plantSession: Session;
    /** Someone who is not a demo account. */
    let realEmail: string;

    beforeAll(async () => {
      // Prepared on a demo app that is closed again before the other starts: Passport
      // registers its `jwt` strategy process-wide, so two live apps would share one.
      const demoApp = await createTestApp();
      try {
        plantSession = await signIn(demoApp.server, demoEmail('plant'));
        const me = await request(demoApp.server)
          .get(`${API}/auth/me`)
          .set('Authorization', bearer(plantSession));
        expect(me.status).toBe(200);

        const admin = await signInAsAdmin(demoApp.server);
        realEmail = uniqueEmail('real');
        const created = await request(demoApp.server)
          .post(`${API}/users`)
          .set('Authorization', bearer(admin))
          .send({
            email: realEmail,
            displayName: 'พนักงานจริง',
            password: TEST_PASSWORD,
            roles: ['finance'],
          });
        expect(created.status).toBe(201);
      } finally {
        await demoApp.close();
      }
      // Development, so it starts with the demo accounts enabled: the sign-in check is what
      // covers an API that was already running when someone seeded.
      ctx = await createTestApp({ env: { NODE_ENV: 'development', ERP_DEMO: '0' } });
    });
    afterAll(async () => {
      await ctx.close();
    });

    it('refuses the sign-in of a demo account, as a refused sign-in', async () => {
      const res = await request(ctx.server)
        .post(`${API}/auth/login`)
        .set('x-request-id', 'e2e-demo-sign-in-off-01')
        .send({ email: demoEmail('logistics'), password: DEMO_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('DEMO_ACCOUNTS_OFF');
      const lines = ctx
        .logs()
        .filter((l) => l.labels?.correlation_id === 'e2e-demo-sign-in-off-01')
        .map((l) => [l.severity, l.labels.event, l.message]);
      expect(lines).toEqual([
        [
          'WARNING',
          'auth.sign_in.failed',
          'Sign-in refused: a demo account, and this installation is not a demo',
        ],
        ['INFO', 'http.request.completed', 'POST /api/v1/auth/login 401'],
      ]);

      const entry = await prisma.auditLog.findFirst({
        where: { correlationId: 'e2e-demo-sign-in-off-01' },
      });
      expect(entry).toMatchObject({ action: 'LOGIN_FAILED', entityType: 'User' });
    });

    it('still checks the password first, so a wrong one is only a wrong password', async () => {
      const res = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: demoEmail('logistics'), password: 'not the demo password' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('ends a session a demo account already holds', async () => {
      const res = await request(ctx.server)
        .get(`${API}/auth/me`)
        .set('Authorization', bearer(plantSession));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('DEMO_ACCOUNTS_OFF');
    });

    it('lets everyone else sign in as usual', async () => {
      const session = await signIn(ctx.server, realEmail, TEST_PASSWORD);
      expect(session.user.roles).toEqual(['finance']);
    });

    it('tells the console not to show the demo banner', async () => {
      const res = await request(ctx.server).get(`${API}/installation`);
      expect(res.body).toEqual({ demo: false });
    });
  });
});

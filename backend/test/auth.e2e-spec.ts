// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Signing in (#4), end to end: passwords, the second factor, sessions, lockout, and the
 * failed-sign-in log line, metric and audit entry (docs/TELEMETRY.md).
 */
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { generateTotpForStep, timeStepAt } from 'src/modules/auth/domain/totp';
import { DEMO_MFA_SECRET, DEMO_PASSWORD, DEMO_RECOVERY_CODES } from '../prisma/seed';
import {
  acceptableCode,
  API,
  bearer,
  type Body,
  demoEmail,
  lastUsedStep,
  signIn,
  signInAsAdmin,
  signInWithSecondFactor,
  TEST_PASSWORD,
  uniqueEmail,
  type Session,
} from './utils/auth';
import { resolveDatabaseUrl } from './utils/database';
import { createTestApp, type LogLine, type TestContext } from './utils/test-app';

const ADMIN = demoEmail('admin');
const PURCHASING = demoEmail('purchasing');

describe('signing in', () => {
  let ctx: TestContext;
  let admin: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const createUser = async (roles: string[] = [], email = uniqueEmail('user')) => {
    const res = await request(ctx.server)
      .post(`${API}/users`)
      .set('Authorization', bearer(admin))
      .send({ email, displayName: 'E2E user', password: TEST_PASSWORD, roles });
    expect(res.status).toBe(201);
    return res.body as { id: string; email: string };
  };

  const auditFor = async (correlationId: string) => {
    const res = await request(ctx.server)
      .get(`${API}/audit-logs`)
      .query({ correlationId })
      .set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
    return res.body.data as Body[];
  };

  const failureLines = (): LogLine[] =>
    ctx.logs().filter((l) => l.labels?.event === 'auth.sign_in.failed');

  const failureCount = async (): Promise<number> => {
    const res = await request(`http://127.0.0.1:${ctx.metricsPort}`).get('/metrics');
    const line = res.text
      .split('\n')
      .find((l) => l.startsWith('auth_sign_in_failures_total{app="payneat-erp-api"}'));
    if (!line) throw new Error('auth_sign_in_failures_total is not exposed');
    return Number(line.split(' ').pop());
  };

  describe('an account without a second factor', () => {
    it('gets a session for its email and password, whatever the case of the email', async () => {
      const res = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: 'Purchasing@Demo-Chicken.example', password: DEMO_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        mfaRequired: false,
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { email: PURCHASING, roles: ['purchasing'], permissions: [], mfaEnabled: false },
      });
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));

      const me = await request(ctx.server)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${res.body.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(PURCHASING);
    });

    it('is refused with a wrong password: 401, a WARNING line without the email, the metric and an audit entry', async () => {
      const before = await failureCount();
      const linesBefore = failureLines().length;

      const res = await request(ctx.server)
        .post(`${API}/auth/login`)
        .set('x-request-id', 'e2e-wrong-password-01')
        .send({ email: PURCHASING, password: 'not the password at all' });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        requestId: 'e2e-wrong-password-01',
      });

      expect(await failureCount()).toBe(before + 1);
      const lines = failureLines().slice(linesBefore);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        severity: 'WARNING',
        message: 'Sign-in refused: wrong password',
        labels: {
          app: 'payneat-erp-api',
          event: 'auth.sign_in.failed',
          correlation_id: 'e2e-wrong-password-01',
        },
      });
      expect(JSON.stringify(lines[0])).not.toMatch(/purchasing@|not the password/);

      const [entry] = await auditFor('e2e-wrong-password-01');
      expect(entry).toMatchObject({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        correlationId: 'e2e-wrong-password-01',
        actor: { email: PURCHASING },
      });
      expect(entry.summary).toMatch(/^Sign-in refused: wrong password \(attempt 1 of 5\)$/);
      expect(new Date(entry.createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('is refused with an email no account has, which is audited without storing the email', async () => {
      const before = await failureCount();
      const res = await request(ctx.server)
        .post(`${API}/auth/login`)
        .set('x-request-id', 'e2e-unknown-email-01')
        .send({ email: 'nobody.at.all@demo-chicken.example', password: DEMO_PASSWORD });

      // Exactly what a wrong password gets: the answer does not say which emails exist.
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.message).toBe('Invalid email or password');
      expect(await failureCount()).toBe(before + 1);

      const [entry] = await auditFor('e2e-unknown-email-01');
      expect(entry).toMatchObject({
        action: 'LOGIN_FAILED',
        actor: null,
        entityId: null,
        summary: 'Sign-in refused: no account has that email',
      });
      expect(JSON.stringify(entry)).not.toContain('nobody.at.all');
    });

    it('locks after five wrong passwords, and stays locked even for the right one', async () => {
      const user = await createUser();
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const res = await request(ctx.server)
          .post(`${API}/auth/login`)
          .send({ email: user.email, password: `wrong guess ${attempt}` });
        expect(res.status).toBe(401);
      }

      const locked = await request(ctx.server)
        .post(`${API}/auth/login`)
        .set('x-request-id', 'e2e-locked-account-01')
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(locked.status).toBe(422);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');

      const trail = await request(ctx.server)
        .get(`${API}/audit-logs`)
        .query({ entityId: user.id, action: 'LOGIN_FAILED', sortOrder: 'asc' })
        .set('Authorization', bearer(admin));
      expect(trail.body.data.map((e: { summary: string }) => e.summary)).toEqual([
        'Sign-in refused: wrong password (attempt 1 of 5)',
        'Sign-in refused: wrong password (attempt 2 of 5)',
        'Sign-in refused: wrong password (attempt 3 of 5)',
        'Sign-in refused: wrong password (attempt 4 of 5)',
        'Sign-in refused: wrong password (account locked for 15 minutes)',
        'Sign-in refused: the account is locked',
      ]);
    });
  });

  describe('an admin account (second factor required)', () => {
    it('gets only a challenge for its password, which opens nothing', async () => {
      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: ADMIN, password: DEMO_PASSWORD });

      expect(login.status).toBe(200);
      expect(login.body).toMatchObject({ mfaRequired: true, mfaEnrolled: true, expiresIn: 300 });
      expect(login.body.accessToken).toBeUndefined();

      const token = `Bearer ${login.body.challengeToken}`;
      expect(
        (await request(ctx.server).get(`${API}/auth/me`).set('Authorization', token)).status,
      ).toBe(401);
      expect(
        (await request(ctx.server).get(`${API}/users`).set('Authorization', token)).status,
      ).toBe(401);
    });

    it('signs in with a code from the published secret, and a code cannot be used twice', async () => {
      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: ADMIN, password: DEMO_PASSWORD });
      const code = await acceptableCode(DEMO_MFA_SECRET, await lastUsedStep(ADMIN));

      const ok = await request(ctx.server)
        .post(`${API}/auth/mfa/verify`)
        .set('x-request-id', 'e2e-admin-mfa-ok-01')
        .send({ challengeToken: login.body.challengeToken, code });
      expect(ok.status).toBe(200);
      expect(ok.body.user).toMatchObject({
        email: ADMIN,
        roles: ['admin'],
        permissions: ['user:read', 'user:manage', 'audit:read', 'item:manage'],
        mfaEnabled: true,
      });
      const [entry] = await auditFor('e2e-admin-mfa-ok-01');
      expect(entry).toMatchObject({ action: 'LOGIN', summary: 'Signed in with a second factor' });

      const replay = await request(ctx.server)
        .post(`${API}/auth/mfa/verify`)
        .set('x-request-id', 'e2e-admin-replay-01')
        .send({ challengeToken: login.body.challengeToken, code });
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('SECOND_FACTOR_REJECTED');

      // One catalogue line says what happened; no extra app.log line about it (v1.2).
      const lines = ctx
        .logs()
        .filter((l) => l.labels?.correlation_id === 'e2e-admin-replay-01')
        .map((l) => [l.labels.event, l.message]);
      expect(lines).toEqual([
        ['auth.sign_in.failed', 'Sign-in refused: second-factor code already used'],
        ['http.request.completed', 'POST /api/v1/auth/mfa/verify 401'],
      ]);
    });

    it('signs in with a recovery code, once', async () => {
      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: ADMIN, password: DEMO_PASSWORD });
      const code = DEMO_RECOVERY_CODES[0].toLowerCase(); // case and dashes do not matter

      const first = await request(ctx.server)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: login.body.challengeToken, code });
      expect(first.status).toBe(200);

      const again = await request(ctx.server)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: login.body.challengeToken, code });
      expect(again.status).toBe(401);

      const status = await request(ctx.server)
        .get(`${API}/auth/mfa/status`)
        .set('Authorization', `Bearer ${first.body.accessToken}`);
      expect(status.body).toMatchObject({ required: true, enrolled: true });
      expect(status.body.recoveryCodesRemaining).toBe(DEMO_RECOVERY_CODES.length - 1);
    });

    it('counts a wrong code as a failed sign-in', async () => {
      const before = await failureCount();
      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: ADMIN, password: DEMO_PASSWORD });
      const res = await request(ctx.server)
        .post(`${API}/auth/mfa/verify`)
        .set('x-request-id', 'e2e-admin-wrong-code')
        .send({ challengeToken: login.body.challengeToken, code: '000000' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SECOND_FACTOR_REJECTED');
      expect(await failureCount()).toBe(before + 1);
      const [entry] = await auditFor('e2e-admin-wrong-code');
      expect(entry.summary).toMatch(/^Sign-in refused: wrong second-factor code/);
      expect(entry.actor.email).toBe(ADMIN);
    });
  });

  describe('an admin created without a second factor', () => {
    it('has to enrol before its first session; activation finishes the sign-in', async () => {
      const user = await createUser(['admin']);

      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(login.body).toMatchObject({ mfaRequired: true, mfaEnrolled: false });
      const challengeToken = login.body.challengeToken as string;

      const verify = await request(ctx.server)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken, code: '123456' });
      expect(verify.status).toBe(422);
      expect(verify.body.code).toBe('MFA_ENROLMENT_REQUIRED');

      const offer = await request(ctx.server)
        .post(`${API}/auth/mfa/enroll`)
        .send({ challengeToken });
      expect(offer.status).toBe(200);
      expect(offer.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/PaynEat%20ERP%3A/);
      const secret = offer.body.secret as string;

      const wrong = await request(ctx.server)
        .post(`${API}/auth/mfa/activate`)
        .send({ challengeToken, code: '000000' });
      expect(wrong.status).toBe(422);
      expect(wrong.body.code).toBe('MFA_CODE_INVALID');

      const activated = await request(ctx.server)
        .post(`${API}/auth/mfa/activate`)
        .send({ challengeToken, code: generateTotpForStep(secret, timeStepAt(Date.now())) });
      expect(activated.status).toBe(200);
      expect(activated.body.recoveryCodes).toHaveLength(10);
      expect(activated.body.session.user).toMatchObject({ email: user.email, mfaEnabled: true });

      const users = await request(ctx.server)
        .get(`${API}/users`)
        .set('Authorization', `Bearer ${activated.body.session.accessToken}`);
      expect(users.status).toBe(200);

      // From now on a code is asked for at every sign-in.
      const next = await signInWithSecondFactor(ctx.server, user.email, secret, TEST_PASSWORD);
      expect(next.user.roles).toEqual(['admin']);
    });

    it('cannot turn the challenge of an enrolled account into a session without a code', async () => {
      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: ADMIN, password: DEMO_PASSWORD });
      const challengeToken = login.body.challengeToken as string;

      const enrol = await request(ctx.server)
        .post(`${API}/auth/mfa/enroll`)
        .send({ challengeToken });
      expect(enrol.status).toBe(422);
      expect(enrol.body.code).toBe('MFA_ALREADY_ENROLLED');

      const activate = await request(ctx.server)
        .post(`${API}/auth/mfa/activate`)
        .send({ challengeToken, code: '123456' });
      expect(activate.status).toBe(422);
      expect(activate.body.session).toBeUndefined();

      // Cwork's exchange step does not exist here (see auth.service.ts).
      const exchange = await request(ctx.server)
        .post(`${API}/auth/mfa/complete-enrolment`)
        .send({ challengeToken, code: 'enrolled' });
      expect(exchange.status).toBe(404);
    });

    it('loses its session the moment it is given a role that needs a second factor', async () => {
      const user = await createUser(['finance']);
      const session = await signIn(ctx.server, user.email, TEST_PASSWORD);
      expect(
        (await request(ctx.server).get(`${API}/auth/me`).set('Authorization', bearer(session)))
          .status,
      ).toBe(200);

      const grant = await request(ctx.server)
        .put(`${API}/users/${user.id}/roles/admin`)
        .set('Authorization', bearer(admin));
      expect(grant.status).toBe(200);

      expect(
        (await request(ctx.server).get(`${API}/auth/me`).set('Authorization', bearer(session)))
          .status,
      ).toBe(401);
      const refresh = await request(ctx.server)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: session.refreshToken });
      expect(refresh.status).toBe(401);

      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(login.body).toMatchObject({ mfaRequired: true, mfaEnrolled: false });
    });
  });

  describe('sessions', () => {
    it('rotate their refresh token, and a replayed one ends the whole family', async () => {
      const first = await signIn(ctx.server, PURCHASING);

      const rotated = await request(ctx.server)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: first.refreshToken });
      expect(rotated.status).toBe(200);
      expect(rotated.body.refreshToken).not.toBe(first.refreshToken);
      const second = rotated.body as Session;
      expect(
        (await request(ctx.server).get(`${API}/auth/me`).set('Authorization', bearer(second)))
          .status,
      ).toBe(200);

      const replay = await request(ctx.server)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: first.refreshToken });
      expect(replay.status).toBe(401);

      // The leak revoked the newer pair too.
      expect(
        (await request(ctx.server).get(`${API}/auth/me`).set('Authorization', bearer(second)))
          .status,
      ).toBe(401);
      expect(
        (
          await request(ctx.server)
            .post(`${API}/auth/refresh`)
            .send({ refreshToken: second.refreshToken })
        ).status,
      ).toBe(401);
    });

    it('end on sign-out: the access token stops working at once', async () => {
      const session = await signIn(ctx.server, PURCHASING);
      const out = await request(ctx.server)
        .post(`${API}/auth/logout`)
        .set('Authorization', bearer(session))
        .send({ refreshToken: session.refreshToken });
      expect(out.status).toBe(204);

      expect(
        (await request(ctx.server).get(`${API}/auth/me`).set('Authorization', bearer(session)))
          .status,
      ).toBe(401);
      expect(
        (
          await request(ctx.server)
            .post(`${API}/auth/refresh`)
            .send({ refreshToken: session.refreshToken })
        ).status,
      ).toBe(401);
    });

    it('all end when the password changes, and the new password is checked against the policy', async () => {
      const user = await createUser();
      const session = await signIn(ctx.server, user.email, TEST_PASSWORD);
      const change = (body: object) =>
        request(ctx.server)
          .post(`${API}/auth/change-password`)
          .set('Authorization', bearer(session))
          .send(body);

      const wrong = await change({
        currentPassword: 'not it',
        newPassword: 'a brand new passphrase',
      });
      expect(wrong.status).toBe(422);
      expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');

      const weak = await change({ currentPassword: TEST_PASSWORD, newPassword: 'short' });
      expect(weak.status).toBe(422);
      expect(weak.body.code).toBe('WEAK_PASSWORD');

      const ok = await change({
        currentPassword: TEST_PASSWORD,
        newPassword: 'a brand new passphrase',
      });
      expect(ok.status).toBe(204);
      expect(
        (await request(ctx.server).get(`${API}/auth/me`).set('Authorization', bearer(session)))
          .status,
      ).toBe(401);
      await signIn(ctx.server, user.email, 'a brand new passphrase');
    });

    it('refuse garbage and missing tokens with 401', async () => {
      expect((await request(ctx.server).get(`${API}/auth/me`)).status).toBe(401);
      expect(
        (await request(ctx.server).get(`${API}/auth/me`).set('Authorization', 'Bearer not.a.jwt'))
          .status,
      ).toBe(401);
      expect(
        (await request(ctx.server).post(`${API}/auth/refresh`).send({ refreshToken: 'nope' }))
          .status,
      ).toBe(401);
    });
  });

  it('never writes a password, a code, a secret, a token or an email into the logs', async () => {
    const everything = ctx.rawLogs.join('\n');
    for (const secret of [
      DEMO_PASSWORD,
      TEST_PASSWORD,
      DEMO_MFA_SECRET,
      ...DEMO_RECOVERY_CODES,
      admin.accessToken,
      admin.refreshToken,
      'demo-chicken.example',
      'e2e.example',
    ]) {
      expect(everything).not.toContain(secret);
    }
  });
});

describe('rate limits', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ env: { THROTTLE_LIMIT: '3' } });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('answer 429 once an address exceeds the limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await request(ctx.server).get(`${API}/auth/me`)).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    // Health is never limited: orchestrators probe it all day.
    expect((await request(ctx.server).get('/health')).status).toBe(200);
  });
});

describe('the audit trail', () => {
  it('refuses to be rewritten, even from inside the database', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
    try {
      await expect(
        prisma.$executeRawUnsafe(`UPDATE audit_logs SET summary = 'rewritten'`),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_logs`)).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});

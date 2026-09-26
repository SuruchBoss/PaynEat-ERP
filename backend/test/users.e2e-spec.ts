// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * User administration (#4), end to end: the permissions guard proven on every route
 * (401 without a session, 403 with the wrong role, success with the right one), the
 * seven roles, and the audit entry of every change.
 */
import request from 'supertest';
import { generateTotpForStep, timeStepAt } from 'src/modules/auth/domain/totp';
import { DEMO_USERS } from '../prisma/seed';
import {
  API,
  bearer,
  type Body,
  demoEmail,
  signIn,
  signInAsAdmin,
  TEST_PASSWORD,
  uniqueEmail,
  type Session,
} from './utils/auth';
import { createTestApp, type TestContext } from './utils/test-app';

const ROLES = [
  'admin',
  'purchasing',
  'purchasing_approver',
  'plant',
  'logistics',
  'branch_manager',
  'finance',
];

describe('user administration', () => {
  let ctx: TestContext;
  let admin: Session;
  let purchasing: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
    purchasing = await signIn(ctx.server, demoEmail('purchasing'));
  });
  afterAll(async () => {
    await ctx.close();
  });

  const as = (session: Session | null) => ({
    get: (path: string) => {
      const req = request(ctx.server).get(`${API}${path}`);
      return session ? req.set('Authorization', bearer(session)) : req;
    },
    post: (path: string, body: object) => {
      const req = request(ctx.server).post(`${API}${path}`).send(body);
      return session ? req.set('Authorization', bearer(session)) : req;
    },
    put: (path: string) => {
      const req = request(ctx.server).put(`${API}${path}`);
      return session ? req.set('Authorization', bearer(session)) : req;
    },
    delete: (path: string) => {
      const req = request(ctx.server).delete(`${API}${path}`);
      return session ? req.set('Authorization', bearer(session)) : req;
    },
  });

  const newUser = (roles: string[] = []) => ({
    email: uniqueEmail('staff'),
    displayName: 'สมหญิง ทดสอบ',
    password: TEST_PASSWORD,
    roles,
  });

  const trail = async (query: Record<string, string>) => {
    const res = await as(admin)
      .get('/audit-logs')
      .query({ sortOrder: 'asc', ...query });
    expect(res.status).toBe(200);
    return res.body.data as Body[];
  };

  describe('the permissions guard', () => {
    // Every user-administration route, with what the wrong and right callers get.
    const routes: Array<[string, (s: Session | null) => request.Test]> = [
      ['GET /users', (s) => as(s).get('/users')],
      ['GET /roles', (s) => as(s).get('/roles')],
      ['GET /audit-logs', (s) => as(s).get('/audit-logs')],
      ['POST /users', (s) => as(s).post('/users', newUser())],
      ['PUT /users/:id/roles/:role', (s) => as(s).put(`/users/${targetId}/roles/finance`)],
      ['DELETE /users/:id/roles/:role', (s) => as(s).delete(`/users/${targetId}/roles/finance`)],
    ];
    // Someone of the suite's own for the role routes to act on, not a demo account.
    let targetId = '';

    beforeAll(async () => {
      targetId = (await as(admin).post('/users', newUser())).body.id;
    });

    it.each(routes)('%s is 401 without a session', async (_name, call) => {
      const res = await call(null);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it.each(routes)('%s is 403 for a role that may not do it', async (_name, call) => {
      const res = await call(purchasing);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCESS_DENIED');
      expect(res.body.message).toMatch(/^Missing permission: (user|audit):/);
    });

    it.each(routes)('%s succeeds for admin', async (_name, call) => {
      const res = await call(admin);
      expect([200, 201]).toContain(res.status);
    });
  });

  it('lists the seven roles of ADR-0008 and what each allows today', async () => {
    const res = await as(admin).get('/roles');
    expect(res.body.map((r: Body) => r.key)).toEqual(ROLES);
    expect(res.body[0]).toEqual({
      key: 'admin',
      permissions: ['user:read', 'user:manage', 'audit:read', 'item:manage'],
      requiresSecondFactor: true,
    });
    for (const role of res.body.slice(1)) {
      expect(role).toMatchObject({ permissions: [], requiresSecondFactor: false });
    }
  });

  it('lists the demo users, one per role, and never a password hash or second-factor secret', async () => {
    const res = await as(admin).get('/users');
    expect(res.status).toBe(200);
    for (const demo of DEMO_USERS) {
      const user = res.body.find((u: Body) => u.email === demo.email);
      expect(user).toMatchObject({ status: 'ACTIVE', locale: 'th' });
      expect(user.roles).toContain(demo.role);
    }
    const text = JSON.stringify(res.body);
    for (const field of ['passwordHash', 'mfaSecretEnc', 'mfaRecoveryCodes', 'failedLoginCount']) {
      expect(text).not.toContain(field);
    }
    const demoAdmin = res.body.find((u: Body) => u.email === demoEmail('admin'));
    expect(demoAdmin).toMatchObject({ mfaEnabled: true, mfaRequired: true });
  });

  describe('creating a user', () => {
    it('creates them with their roles and audits the creation and each role, with actor, time and correlation id', async () => {
      const body = newUser(['plant', 'logistics']);
      const res = await as(admin)
        .post('/users', { ...body, email: body.email.toUpperCase(), locale: 'en' })
        .set('x-request-id', 'e2e-create-user-001');

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        email: body.email,
        displayName: 'สมหญิง ทดสอบ',
        locale: 'en',
        status: 'ACTIVE',
        roles: ['plant', 'logistics'],
        mfaEnabled: false,
        mfaRequired: false,
        lastLoginAt: null,
      });

      const entries = await trail({ correlationId: 'e2e-create-user-001' });
      expect(entries.map((e) => [e.action, e.summary])).toEqual([
        ['CREATE', `Created user ${body.email}`],
        ['ROLE_GRANTED', `Granted role plant to ${body.email}`],
        ['ROLE_GRANTED', `Granted role logistics to ${body.email}`],
      ]);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          entityType: 'User',
          entityId: res.body.id,
          correlationId: 'e2e-create-user-001',
          actor: { id: admin.user.id, email: demoEmail('admin') },
        });
        expect(Date.now() - new Date(entry.createdAt).getTime()).toBeLessThan(60_000);
        expect(JSON.stringify(entry)).not.toContain(TEST_PASSWORD);
      }

      // The new user can sign in straight away with the password they were given. Roles
      // come back in the order ADR-0008 lists them.
      const session = await signIn(ctx.server, body.email, TEST_PASSWORD);
      expect(session.user.roles).toEqual(['plant', 'logistics']);
    });

    it('refuses a taken email, a weak password, an unknown role and fields it does not know', async () => {
      const taken = await as(admin).post('/users', { ...newUser(), email: demoEmail('finance') });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('EMAIL_TAKEN');

      const weak = await as(admin).post('/users', { ...newUser(), password: 'password123' });
      expect(weak.status).toBe(422);
      expect(weak.body.code).toBe('WEAK_PASSWORD');
      expect(weak.body.details.problems).toEqual(
        expect.arrayContaining(['must be at least 12 characters', 'is too common']),
      );

      const role = await as(admin).post('/users', newUser(['superuser']));
      expect(role.status).toBe(400);

      // Mass assignment: nobody sneaks a second factor, a status or a hash in.
      const extra = await as(admin).post('/users', { ...newUser(), mfaEnabled: true });
      expect(extra.status).toBe(400);
      expect(extra.body.message).toMatch(/mfaEnabled should not exist/);
    });
  });

  describe('granting and revoking roles', () => {
    it('grants and revokes, audits each change once, and takes effect on the next request', async () => {
      const created = await as(admin).post('/users', newUser());
      const id = created.body.id as string;
      const session = await signIn(ctx.server, created.body.email, TEST_PASSWORD);

      const granted = await as(admin)
        .put(`/users/${id}/roles/branch_manager`)
        .set('x-request-id', 'e2e-grant-role-0001');
      expect(granted.status).toBe(200);
      expect(granted.body.roles).toEqual(['branch_manager']);

      // Idempotent: already held, nothing changes and nothing is recorded.
      const again = await as(admin)
        .put(`/users/${id}/roles/branch_manager`)
        .set('x-request-id', 'e2e-grant-role-0002');
      expect(again.status).toBe(200);
      expect(await trail({ correlationId: 'e2e-grant-role-0002' })).toEqual([]);

      const me = await request(ctx.server)
        .get(`${API}/auth/me`)
        .set('Authorization', bearer(session));
      expect(me.body.roles).toEqual(['branch_manager']);

      const revoked = await as(admin)
        .delete(`/users/${id}/roles/branch_manager`)
        .set('x-request-id', 'e2e-revoke-role-001');
      expect(revoked.status).toBe(200);
      expect(revoked.body.roles).toEqual([]);

      const [grant] = await trail({ correlationId: 'e2e-grant-role-0001' });
      const [revoke] = await trail({ correlationId: 'e2e-revoke-role-001' });
      expect(grant).toMatchObject({
        action: 'ROLE_GRANTED',
        entityId: id,
        changes: { role: 'branch_manager' },
        actor: { email: demoEmail('admin') },
      });
      expect(revoke).toMatchObject({
        action: 'ROLE_REVOKED',
        entityId: id,
        changes: { role: 'branch_manager' },
        actor: { email: demoEmail('admin') },
      });
    });

    it('refuses an unknown role, and a user that does not exist', async () => {
      expect((await as(admin).put(`/users/${admin.user.id}/roles/owner`)).status).toBe(400);
      expect((await as(admin).put(`/users/not-a-uuid/roles/finance`)).status).toBe(400);
      const missing = await as(admin).put(
        '/users/00000000-0000-4000-8000-000000000000/roles/finance',
      );
      expect(missing.status).toBe(404);
    });

    it('never removes the last active administrator, and a removal applies at once', async () => {
      // A second administrator, enrolled through the API like a real person.
      const created = await as(admin).post('/users', newUser(['admin']));
      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: created.body.email, password: TEST_PASSWORD });
      const challengeToken = login.body.challengeToken;
      const offer = await request(ctx.server)
        .post(`${API}/auth/mfa/enroll`)
        .send({ challengeToken });
      const activated = await request(ctx.server)
        .post(`${API}/auth/mfa/activate`)
        .send({
          challengeToken,
          code: generateTotpForStep(offer.body.secret, timeStepAt(Date.now())),
        });
      const second = activated.body.session as Session;

      const users = await as(second).get('/users');
      const otherAdmins = (users.body as Body[]).filter(
        (u) => u.roles.includes('admin') && u.id !== second.user.id,
      );
      expect(otherAdmins.map((u) => u.email)).toContain(demoEmail('admin'));

      try {
        for (const other of otherAdmins) {
          expect((await as(second).delete(`/users/${other.id}/roles/admin`)).status).toBe(200);
        }
        // The demo admin's session lost its permissions on the very next request.
        expect((await as(admin).get('/users')).status).toBe(403);

        const last = await as(second).delete(`/users/${second.user.id}/roles/admin`);
        expect(last.status).toBe(409);
        expect(last.body.code).toBe('LAST_ADMIN');
      } finally {
        for (const other of otherAdmins) {
          expect((await as(second).put(`/users/${other.id}/roles/admin`)).status).toBe(200);
        }
      }
      expect((await as(admin).get('/users')).status).toBe(200);
    });
  });

  it('filters the audit trail and pages through it', async () => {
    const page = await as(admin).get('/audit-logs').query({ action: 'ROLE_GRANTED', limit: 2 });
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ page: 1, limit: 2, hasNext: true });
    for (const entry of page.body.data) expect(entry.action).toBe('ROLE_GRANTED');

    expect((await as(admin).get('/audit-logs').query({ action: 'NOPE' })).status).toBe(400);
    expect((await as(admin).get('/audit-logs').query({ limit: 500 })).status).toBe(400);
  });
});

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The POS integration (#9), end to end against a real PostgreSQL, checked against the contract
 * files themselves: registering an instance and its credential (shown once, revocable, audited),
 * the master-data pull by version, sales events stored exactly once however many copies arrive
 * together, every refusal logged and counted with its reason, and the telemetry v1.2 rules —
 * `pos_instance` and `location_code` on every integration line, the idempotency key as the
 * correlation id, and the last pull read from the database so it survives a restart.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import {
  API,
  bearer,
  type Body,
  demoEmail,
  signIn,
  signInAsAdmin,
  type Session,
} from './utils/auth';
import { createTestApp, type TestContext } from './utils/test-app';

const V1 = resolve(__dirname, '../../contracts/pos/v1');
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const schema = (file: string) =>
  ajv.compile(JSON.parse(readFileSync(join(V1, file), 'utf8')) as object);
const CONTRACT = {
  instance: schema('pos-instance.schema.json'),
  changes: schema('master-data-changes.schema.json'),
  receipt: schema('sales-event-receipt.schema.json'),
  error: schema('error.schema.json'),
};
const conforms = (validate: ReturnType<typeof schema>, body: unknown) => {
  const ok = validate(body);
  expect(validate.errors ?? []).toEqual([]);
  expect(ok).toBe(true);
};

let counter = 0;
const unique = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${counter}`;
};

describe('POS integration', () => {
  let ctx: TestContext;
  let admin: Session;
  let plant: Session;
  let prisma: PrismaService;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
    plant = await signIn(ctx.server, demoEmail('plant'));
    prisma = ctx.app.get(PrismaService);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const as = (session: Session | null) => {
    const auth = (req: request.Test) => (session ? req.set('Authorization', bearer(session)) : req);
    return {
      get: (path: string) => auth(request(ctx.server).get(`${API}${path}`)),
      post: (path: string, body: object = {}) =>
        auth(request(ctx.server).post(`${API}${path}`).send(body)),
    };
  };
  const machine = (credential: string | null, requestId?: string) => {
    const auth = (req: request.Test) => {
      const withAuth = credential ? req.set('Authorization', `Bearer ${credential}`) : req;
      return requestId ? withAuth.set('x-request-id', requestId) : withAuth;
    };
    return {
      get: (path: string) => auth(request(ctx.server).get(`${API}${path}`)),
      post: (path: string, body: unknown) =>
        auth(
          request(ctx.server)
            .post(`${API}${path}`)
            .send(body as object),
        ),
    };
  };

  const newBranch = async (): Promise<Body> => {
    const res = await as(admin).post('/locations', {
      code: unique('BR'),
      type: 'branch',
      nameTh: 'สาขาทดสอบ',
      nameEn: 'Test branch',
    });
    expect(res.status).toBe(201);
    return res.body;
  };
  const register = async (branchCodes: string[]): Promise<Body> => {
    const res = await as(admin).post('/pos-instances', {
      code: unique('POS'),
      name: 'Front counter',
      branchCodes,
    });
    expect(res.status).toBe(201);
    return res.body;
  };

  const event = (instance: Body, branchCode: string, overrides: Body = {}): Body => ({
    schemaVersion: 1,
    idempotencyKey: unique(`${instance.code}-line`),
    posInstance: instance.code,
    branchCode,
    saleTime: '2026-09-27T12:34:56+07:00',
    menuItemCode: 'SET-WINGS-6',
    quantity: '2',
    modifiers: [{ code: 'SAUCE-HOT', quantity: '1' }],
    ...overrides,
  });
  const send = (credential: string | null, body: Body) =>
    machine(credential, body.idempotencyKey as string).post('/sales-events', body);

  const metric = async (name: string, labels: Record<string, string>): Promise<number | null> => {
    const text = (await request(`http://127.0.0.1:${ctx.metricsPort}`).get('/metrics')).text;
    const wanted = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    const line = text
      .split('\n')
      .find((l) => l.startsWith(`${name}{`) && wanted.every((w) => l.includes(w)));
    return line ? Number(line.split(' ').pop()) : null;
  };
  const events = (outcome: string, reason = '') =>
    metric('erp_sales_events_total', { outcome, reason }).then((v) => v ?? 0);
  const lines = (event: string) => ctx.logs().filter((l) => l.labels?.event === event);
  const completed = (requestId: string) =>
    ctx
      .logs()
      .find(
        (l) =>
          l.labels?.event === 'http.request.completed' && l.labels?.correlation_id === requestId,
      );

  describe('registering a POS instance', () => {
    it('shows the credential once, keeps only its hash, and audits it; admin only', async () => {
      const branch = await newBranch();
      const code = unique('pos');
      const res = await as(admin).post('/pos-instances', {
        code,
        name: ' Silom counter ',
        branchCodes: [branch.code.toLowerCase()],
      });
      expect(res.status).toBe(201);
      expect(res.body.credential).toMatch(/^pnepos_[A-Za-z0-9_-]{43}$/);
      expect(res.body.instance).toMatchObject({
        code: code.toUpperCase(),
        name: 'Silom counter',
        branches: [{ code: branch.code, active: true }],
        credential: { issuedBy: { id: admin.user.id } },
        lastPullAt: null,
      });

      const again = await as(admin).get(`/pos-instances/${res.body.instance.id}`);
      expect(JSON.stringify(again.body)).not.toContain(res.body.credential);
      const stored = await prisma.posCredential.findMany({
        where: { posInstanceId: res.body.instance.id },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored[0].tokenHash).not.toContain(res.body.credential.slice(7, 20));

      const trail = await as(admin)
        .get('/audit-logs')
        .query({ entityType: 'PosInstance', entityId: res.body.instance.id });
      expect(trail.body.data).toMatchObject([
        {
          action: 'CREATE',
          changes: { instanceCode: code.toUpperCase(), branchCodes: [branch.code] },
        },
      ]);
      expect(JSON.stringify(trail.body)).not.toContain(res.body.credential);

      expect((await as(plant).get('/pos-instances')).status).toBe(403);
      expect((await as(plant).post('/pos-instances', { code: 'X1', name: 'x' })).status).toBe(403);
      expect((await as(null).get('/pos-instances')).status).toBe(401);
    });

    it('refuses a code taken, and branches that are not branches or not in use', async () => {
      const branch = await newBranch();
      const first = await register([branch.code]);
      const taken = await as(admin).post('/pos-instances', {
        code: first.instance.code,
        name: 'x',
        branchCodes: [branch.code],
      });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('POS_INSTANCE_CODE_TAKEN');

      const cases: Array<[Body, string]> = [
        [{ branchCodes: ['PLANT-01'] }, 'UNKNOWN_BRANCH'],
        [{ branchCodes: ['BR-NOWHERE'] }, 'UNKNOWN_BRANCH'],
        [{ branchCodes: [] }, 'INVALID_POS_INSTANCE'],
        [{ code: 'P' }, 'INVALID_POS_INSTANCE'],
      ];
      for (const [change, code] of cases) {
        const res = await as(admin).post('/pos-instances', {
          code: unique('POS'),
          name: 'x',
          branchCodes: [branch.code],
          ...change,
        });
        expect({ status: res.status, code: res.body.code }).toEqual({ status: 422, code });
      }
    });
  });

  describe('the POS side, as the contract describes it', () => {
    it('tells the instance who it is and which branches it serves', async () => {
      const [a, b] = [await newBranch(), await newBranch()];
      const { instance, credential } = await register([b.code, a.code]);
      const res = await machine(credential).get('/pos/instance');
      expect(res.status).toBe(200);
      conforms(CONTRACT.instance, res.body);
      expect(res.body).toEqual({
        code: instance.code,
        name: 'Front counter',
        contractVersion: '1.0.0',
        branches: [a, b]
          .sort((x, y) => x.code.localeCompare(y.code))
          .map((x) => ({ code: x.code, nameTh: x.nameTh, nameEn: x.nameEn, active: true })),
      });
    });

    it('serves master data by version, page by page, and records the pull', async () => {
      const branch = await newBranch();
      const { instance, credential } = await register([branch.code]);
      const pull = (since: number, limit: number, requestId: string) =>
        machine(credential, requestId).get('/master-data/changes').query({ since, limit });

      const first = await pull(0, 2, unique('pull'));
      expect(first.status).toBe(200);
      conforms(CONTRACT.changes, first.body);
      expect(first.body.changes).toHaveLength(2);
      expect(first.body.hasMore).toBe(true);

      // Every page, to the end: in version order, items and branches, each as the contract says.
      const seen: Body[] = [];
      let since = 0;
      for (;;) {
        const page = await pull(since, 500, unique('pull'));
        conforms(CONTRACT.changes, page.body);
        seen.push(...page.body.changes);
        if (!page.body.hasMore) break;
        since = page.body.changes.at(-1).version;
      }
      const versions = seen.map((c) => c.version);
      expect(versions).toEqual([...versions].sort((x, y) => x - y));
      expect(new Set(seen.map((c) => c.entityType))).toEqual(new Set(['item', 'location']));
      expect(seen.find((c) => c.entityCode === branch.code)).toMatchObject({
        entityType: 'location',
        data: { locationCode: branch.code, type: 'branch', supersededBy: null },
      });

      const requestId = unique('pull');
      await pull(versions.at(-1)!, 500, requestId);
      const pulled = lines('master_data.pulled').filter(
        (l) => l.labels.correlation_id === requestId,
      );
      expect(pulled).toMatchObject([
        { severity: 'INFO', labels: { pos_instance: instance.code, location_code: branch.code } },
      ]);
      expect(completed(requestId)).toMatchObject({
        labels: { pos_instance: instance.code, location_code: branch.code },
      });

      const stored = await prisma.posInstance.findUniqueOrThrow({ where: { id: instance.id } });
      expect(stored.lastPullAt).not.toBeNull();
      expect(
        await metric('erp_master_data_last_pull_timestamp_seconds', {
          pos_instance: instance.code,
        }),
      ).toBe(stored.lastPullAt!.getTime() / 1000);

      // A signed-in person still reads the log; that is not a pull.
      const byPerson = await as(plant).get('/master-data/changes').query({ since: 0, limit: 1 });
      expect(byPerson.status).toBe(200);
      expect(
        (await prisma.posInstance.findUniqueOrThrow({ where: { id: instance.id } })).lastPullAt,
      ).toEqual(stored.lastPullAt);
    });
  });

  describe('sales events', () => {
    it('stores a counted and a weighed line once, and answers a duplicate as the original', async () => {
      const branch = await newBranch();
      const { instance, credential } = await register([branch.code]);
      const counted = event(instance, branch.code);
      const [receivedBefore, duplicateBefore] = [
        await events('received'),
        await events('duplicate'),
      ];

      const first = await send(credential, counted);
      expect(first.status).toBe(201);
      conforms(CONTRACT.receipt, first.body);
      expect(first.body).toMatchObject({
        idempotencyKey: counted.idempotencyKey,
        status: 'received',
        duplicate: false,
      });

      const second = await send(credential, { ...counted, modifiers: [...counted.modifiers] });
      expect(second.status).toBe(200);
      conforms(CONTRACT.receipt, second.body);
      expect(second.body).toEqual({ ...first.body, duplicate: true });

      const weighed = event(instance, branch.code, {
        quantity: undefined,
        weightKg: '0.450',
        menuItemCode: 'FRIED-CHICKEN-BY-WEIGHT',
        modifiers: [],
      });
      expect((await send(credential, weighed)).status).toBe(201);

      const stored = await prisma.salesEvent.findMany({
        where: { posInstanceId: instance.id },
        orderBy: { receivedAt: 'asc' },
      });
      expect(
        stored.map((s) => ({
          key: s.idempotencyKey,
          quantity: s.quantity?.toFixed() ?? null,
          weightKg: s.weightKg?.toFixed(3) ?? null,
          status: s.status,
          saleTime: s.saleTime.toISOString(),
        })),
      ).toEqual([
        {
          key: counted.idempotencyKey,
          quantity: '2',
          weightKg: null,
          status: 'received',
          saleTime: '2026-09-27T05:34:56.000Z',
        },
        {
          key: weighed.idempotencyKey,
          quantity: null,
          weightKg: '0.450',
          status: 'received',
          saleTime: '2026-09-27T05:34:56.000Z',
        },
      ]);
      expect(await events('received')).toBe(receivedBefore + 2);
      expect(await events('duplicate')).toBe(duplicateBefore + 1);

      // Every line about the event carries its key as the correlation id, the instance and the branch.
      for (const name of ['sales_event.received', 'sales_event.duplicate']) {
        expect(
          lines(name).filter((l) => l.labels.correlation_id === counted.idempotencyKey),
        ).toMatchObject([
          { severity: 'INFO', labels: { pos_instance: instance.code, location_code: branch.code } },
        ]);
      }
      expect(completed(counted.idempotencyKey)).toMatchObject({
        labels: { pos_instance: instance.code, location_code: branch.code },
      });
    });

    it('stores the same event exactly once when several copies arrive at the same moment', async () => {
      const branch = await newBranch();
      const { instance, credential } = await register([branch.code]);
      const body = event(instance, branch.code);
      const results = await Promise.all(Array.from({ length: 8 }, () => send(credential, body)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
      expect(new Set(results.map((r) => r.body.receivedAt)).size).toBe(1);
      expect(
        await prisma.salesEvent.count({ where: { idempotencyKey: body.idempotencyKey } }),
      ).toBe(1);
    });

    it('refuses, with the reason, what will never be accepted, and logs and counts it', async () => {
      const [served, other] = [await newBranch(), await newBranch()];
      const { instance, credential } = await register([served.code]);
      const stored = event(instance, served.code);
      expect((await send(credential, stored)).status).toBe(201);

      const cases: Array<[string, Body, string | undefined]> = [
        ['schema_invalid', event(instance, served.code, { weightKg: '0.450' }), served.code],
        ['schema_invalid', event(instance, served.code, { quantity: '-1' }), served.code],
        [
          'pos_instance_mismatch',
          event(instance, served.code, { posInstance: 'POS-OTHER' }),
          served.code,
        ],
        ['branch_not_served', event(instance, other.code), other.code],
        ['idempotency_key_reused', { ...stored, quantity: '3' }, served.code],
      ];
      for (const [reason, body, branch] of cases) {
        const before = await events('rejected', reason);
        const res = await send(credential, body);
        expect({
          status: res.status,
          code: res.body.code,
          reason: res.body.details?.reason,
        }).toEqual({ status: 422, code: 'SALES_EVENT_REJECTED', reason });
        conforms(CONTRACT.error, res.body);
        expect(await events('rejected', reason)).toBe(before + 1);
        const line = lines('sales_event.rejected').find(
          (l) => l.labels.correlation_id === body.idempotencyKey && l.labels.reason === reason,
        );
        expect(line).toMatchObject({
          severity: 'WARNING',
          labels: { pos_instance: instance.code, ...(branch ? { location_code: branch } : {}) },
        });
      }
      const invalid = await send(credential, event(instance, served.code, { weightKg: '0.450' }));
      expect(invalid.body.details.errors.length).toBeGreaterThan(0);
      expect(await prisma.salesEvent.count({ where: { posInstanceId: instance.id } })).toBe(1);
    });
  });

  describe('credentials', () => {
    it('refuses a revoked or unknown credential as an integration event, never logging it', async () => {
      const branch = await newBranch();
      const { instance, credential } = await register([branch.code]);
      expect((await as(admin).post(`/pos-instances/${instance.id}/revoke`)).status).toBe(200);
      expect((await as(admin).post(`/pos-instances/${instance.id}/revoke`)).status).toBe(409);

      const revokedBefore = await events('rejected', 'credential_revoked');
      const body = event(instance, branch.code);
      const refused = await send(credential, body);
      expect(refused.status).toBe(401);
      conforms(CONTRACT.error, refused.body);
      expect(refused.body).toMatchObject({
        code: 'POS_CREDENTIAL_REJECTED',
        details: { reason: 'credential_revoked' },
      });
      expect(await events('rejected', 'credential_revoked')).toBe(revokedBefore + 1);
      expect(
        lines('sales_event.rejected').find((l) => l.labels.correlation_id === body.idempotencyKey),
      ).toMatchObject({
        severity: 'WARNING',
        labels: { reason: 'credential_revoked', pos_instance: instance.code },
      });

      const pullId = unique('pull');
      const pull = await machine(credential, pullId).get('/master-data/changes');
      expect(pull.status).toBe(401);
      expect(
        lines('master_data.pull_refused').find((l) => l.labels.correlation_id === pullId),
      ).toMatchObject({
        severity: 'WARNING',
        labels: { reason: 'credential_revoked', pos_instance: instance.code },
      });

      const unknownBefore = await events('rejected', 'credential_unknown');
      const stranger = `pnepos_${'x'.repeat(43)}`;
      for (const token of [stranger, null, 'not-a-credential']) {
        const other = event(instance, branch.code);
        const res = await send(token, other);
        expect(res.status).toBe(401);
        expect(res.body.details).toEqual({ reason: 'credential_unknown' });
        const line = lines('sales_event.rejected').find(
          (l) => l.labels.correlation_id === other.idempotencyKey,
        );
        expect(line?.labels.reason).toBe('credential_unknown');
        expect(line?.labels.pos_instance).toBeUndefined();
      }
      expect(await events('rejected', 'credential_unknown')).toBe(unknownBefore + 3);
      const unknownPullId = unique('pull');
      expect((await machine(stranger, unknownPullId).get('/master-data/changes')).status).toBe(401);
      expect(
        lines('master_data.pull_refused').find((l) => l.labels.correlation_id === unknownPullId)
          ?.labels,
      ).toMatchObject({ reason: 'credential_unknown' });

      const everything = ctx.rawLogs.join('\n');
      expect(everything).not.toContain(credential);
      expect(everything).not.toContain(stranger);
    });

    it('issues a new credential: the old one stops working at once, and both steps are audited', async () => {
      const branch = await newBranch();
      const { instance, credential: old } = await register([branch.code]);
      const issued = await as(admin).post(`/pos-instances/${instance.id}/credentials`);
      expect(issued.status).toBe(201);
      expect(issued.body.credential).not.toBe(old);
      expect((await machine(old).get('/pos/instance')).body.details).toEqual({
        reason: 'credential_revoked',
      });
      expect((await machine(issued.body.credential).get('/pos/instance')).status).toBe(200);
      await as(admin).post(`/pos-instances/${instance.id}/revoke`);

      const trail = await as(admin)
        .get('/audit-logs')
        .query({ entityType: 'PosInstance', entityId: instance.id, sortOrder: 'asc' });
      expect(trail.body.data.map((e: Body) => e.action)).toEqual(['CREATE', 'UPDATE', 'REVOKE']);
      expect(JSON.stringify(trail.body)).not.toContain(issued.body.credential);
    });
  });

  describe('the last pull', () => {
    it('is read from the database, so it survives a restart of the API', async () => {
      const branch = await newBranch();
      const { instance, credential } = await register([branch.code]);
      expect(
        (await machine(credential).get('/master-data/changes').query({ since: 0 })).status,
      ).toBe(200);
      const before = await metric('erp_master_data_last_pull_timestamp_seconds', {
        pos_instance: instance.code,
      });
      expect(before).toBeGreaterThan(0);

      await ctx.close();
      ctx = await createTestApp();
      expect(
        await metric('erp_master_data_last_pull_timestamp_seconds', {
          pos_instance: instance.code,
        }),
      ).toBe(before);
    });
  });

  describe('a branch catching up after an outage', () => {
    it('slows to the rate limit with Retry-After, loses nothing, and leaves other routes alone', async () => {
      // Two tablets at one branch, so one address: they share the sales-event budget.
      const branch = await newBranch();
      const front = await register([branch.code]);
      const back = await register([branch.code]);
      await ctx.close();
      ctx = await createTestApp({ env: { THROTTLE_LIMIT: '3', THROTTLE_TTL: '2' } });

      const backlog = [
        event(front.instance, branch.code),
        event(back.instance, branch.code),
        event(front.instance, branch.code),
        event(back.instance, branch.code),
      ];
      const credentialOf = (body: Body) =>
        body.posInstance === front.instance.code ? front.credential : back.credential;
      const statuses: number[] = [];
      for (const body of backlog) statuses.push((await send(credentialOf(body), body)).status);
      expect(statuses).toEqual([201, 201, 201, 429]);
      const limited = await send(credentialOf(backlog[3]), backlog[3]);
      expect(limited.status).toBe(429);
      conforms(CONTRACT.error, limited.body);
      expect(limited.body.code).toBe('RATE_LIMITED');
      const wait = Number(limited.headers['retry-after']);
      expect(wait).toBeGreaterThanOrEqual(1);

      // The count is per route and per address: the same tablet can still pull, and a person
      // at the same branch can still use the console, while the sales events wait.
      expect(
        (await machine(front.credential).get('/master-data/changes').query({ since: 0 })).status,
      ).toBe(200);
      const manager = await signInAsAdmin(ctx.server);
      expect((await as(manager).get('/locations')).status).toBe(200);

      // Waiting as told and sending the same event again stores it: nothing is lost.
      await new Promise((done) => setTimeout(done, wait * 1000 + 100));
      expect((await send(credentialOf(backlog[3]), backlog[3])).status).toBe(201);
      expect(
        await prisma.salesEvent.count({
          where: { idempotencyKey: { in: backlog.map((b) => b.idempotencyKey as string) } },
        }),
      ).toBe(4);
    });
  });
});

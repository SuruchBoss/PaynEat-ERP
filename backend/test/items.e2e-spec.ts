// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Items, units and the master data change log (#5), end to end: create, edit,
 * deactivate, every validation failure, who may do what, the audit entry of each change,
 * and a strictly increasing company-wide version even under concurrent writes.
 */
import request from 'supertest';
import { DEMO_ITEMS } from '../prisma/seed';
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

let codeCounter = 0;
/** A code no other test uses, in the item code shape. */
const uniqueCode = (prefix: string) => {
  codeCounter += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${codeCounter}`;
};

describe('items and the master data change log', () => {
  let ctx: TestContext;
  let admin: Session;
  let branchManager: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
    branchManager = await signIn(ctx.server, demoEmail('branch_manager'));
  });
  afterAll(async () => {
    await ctx.close();
  });

  const as = (session: Session | null) => {
    const auth = (req: request.Test) => (session ? req.set('Authorization', bearer(session)) : req);
    return {
      get: (path: string) => auth(request(ctx.server).get(`${API}${path}`)),
      post: (path: string, body: object) =>
        auth(request(ctx.server).post(`${API}${path}`).send(body)),
      patch: (path: string, body: object) =>
        auth(request(ctx.server).patch(`${API}${path}`).send(body)),
      delete: (path: string) => auth(request(ctx.server).delete(`${API}${path}`)),
    };
  };

  const newItem = (overrides: Body = {}) => ({
    code: uniqueCode('E2E'),
    nameTh: 'ปีกไก่บน',
    nameEn: 'Chicken wingette',
    baseUnitCode: 'kg',
    variableWeight: true,
    shelfLifeDays: 3,
    purchaseUnits: [{ unitCode: 'case', factor: '10.000' }],
    ...overrides,
  });

  const create = async (overrides: Body = {}): Promise<Body> => {
    const res = await as(admin).post('/items', newItem(overrides));
    expect(res.status).toBe(201);
    return res.body;
  };

  const changesSince = async (since: number, limit?: number): Promise<Body> => {
    const res = await as(branchManager)
      .get('/master-data/changes')
      .query(limit ? { since, limit } : { since });
    expect(res.status).toBe(200);
    return res.body;
  };

  const auditOf = async (itemId: string): Promise<Body[]> => {
    const res = await as(admin)
      .get('/audit-logs')
      .query({ entityType: 'Item', entityId: itemId, sortOrder: 'asc' });
    expect(res.status).toBe(200);
    return res.body.data;
  };

  describe('units', () => {
    it('lists the catalogue every installation ships with, to anyone signed in', async () => {
      const res = await as(branchManager).get('/units');
      expect(res.status).toBe(200);
      expect(res.body).toContainEqual({
        code: 'kg',
        nameTh: 'กิโลกรัม',
        nameEn: 'kilogram',
        decimals: 3,
      });
      expect(res.body).toContainEqual({
        code: 'piece',
        nameTh: 'ชิ้น',
        nameEn: 'piece',
        decimals: 0,
      });
      expect(res.body.map((u: Body) => u.code)).toEqual(
        [...res.body.map((u: Body) => u.code)].sort(),
      );
    });

    it('needs a session', async () => {
      expect((await as(null).get('/units')).status).toBe(401);
    });
  });

  describe('the demo seed', () => {
    it('adds the chain items, each as a master data change', async () => {
      const res = await as(branchManager).get('/items');
      const codes = res.body.map((i: Body) => i.code);
      for (const demo of DEMO_ITEMS) expect(codes).toContain(demo.code);

      const whole = res.body.find((i: Body) => i.code === 'WHOLE-CHICKEN');
      expect(whole).toMatchObject({
        nameTh: 'ไก่ทั้งตัว',
        baseUnitCode: 'kg',
        variableWeight: true,
        purchaseUnits: [{ unitCode: 'case', factor: '20' }],
        active: true,
      });

      const log = await changesSince(0, 1000);
      const seeded = log.changes.filter((c: Body) => c.entityType === 'item');
      for (const demo of DEMO_ITEMS) {
        expect(seeded.map((c: Body) => c.entityCode)).toContain(demo.code);
      }
    });
  });

  describe('creating an item', () => {
    it('stores it with its purchase units, a version, a change and an audit entry', async () => {
      const before = await changesSince(0, 1);
      const res = await as(admin)
        .post(
          '/items',
          newItem({
            code: ' e2e-wingette ',
            purchaseUnits: [{ unitCode: 'case', factor: '10.000' }],
          }),
        )
        .set('x-request-id', 'e2e-item-create-01');

      expect(res.status).toBe(201);
      const item = res.body;
      expect(item).toMatchObject({
        code: 'E2E-WINGETTE',
        nameTh: 'ปีกไก่บน',
        nameEn: 'Chicken wingette',
        baseUnitCode: 'kg',
        variableWeight: true,
        shelfLifeDays: 3,
        active: true,
        purchaseUnits: [{ unitCode: 'case', factor: '10' }],
      });
      expect(item.version).toBe(before.latestVersion + 1);

      const { changes, latestVersion } = await changesSince(before.latestVersion);
      expect(latestVersion).toBe(item.version);
      expect(changes).toEqual([
        {
          version: item.version,
          entityType: 'item',
          entityId: item.id,
          entityCode: 'E2E-WINGETTE',
          action: 'created',
          data: {
            id: item.id,
            itemCode: 'E2E-WINGETTE',
            nameTh: 'ปีกไก่บน',
            nameEn: 'Chicken wingette',
            baseUnitCode: 'kg',
            variableWeight: true,
            shelfLifeDays: 3,
            active: true,
            purchaseUnits: [{ unitCode: 'case', factor: '10' }],
            version: item.version,
          },
          changedAt: expect.any(String),
        },
      ]);

      const [entry, ...more] = await auditOf(item.id);
      expect(more).toHaveLength(0);
      expect(entry).toMatchObject({
        action: 'CREATE',
        entityType: 'Item',
        summary: 'Created item E2E-WINGETTE (Chicken wingette)',
        correlationId: 'e2e-item-create-01',
        actor: { email: demoEmail('admin') },
        changes: { itemCode: 'E2E-WINGETTE', purchaseUnits: [{ unitCode: 'case', factor: '10' }] },
      });
    });

    it('refuses a code that is already taken', async () => {
      const item = await create();
      const res = await as(admin).post('/items', newItem({ code: item.code.toLowerCase() }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ITEM_CODE_TAKEN');
    });

    it.each([
      ['a code with a space', { code: 'WHOLE CHICKEN' }],
      ['a one-character code', { code: 'W' }],
      ['a code starting with a hyphen', { code: '-WING' }],
      ['a missing Thai name', { nameTh: '   ' }],
      ['a missing English name', { nameEn: undefined }],
      ['a shelf life of zero days', { shelfLifeDays: 0 }],
      ['a fractional shelf life', { shelfLifeDays: 1.5 }],
      ['a factor sent as a number', { purchaseUnits: [{ unitCode: 'case', factor: 10 }] }],
      ['an unknown field', { deletedAt: '2026-01-01' }],
      ['a version (it is not the caller’s to choose)', { version: 1 }],
    ])('refuses %s (400)', async (_name, overrides) => {
      const res = await as(admin).post('/items', newItem(overrides));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('refuses an unknown base unit', async () => {
      const res = await as(admin).post('/items', newItem({ baseUnitCode: 'crate' }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('UNKNOWN_UNIT');
    });

    it('refuses zero, negative and too precise factors, naming each row', async () => {
      const res = await as(admin).post(
        '/items',
        newItem({
          purchaseUnits: [
            { unitCode: 'case', factor: '0' },
            { unitCode: 'bag', factor: '-25' },
            { unitCode: 'sack', factor: '0.0000001' },
            { unitCode: 'kg', factor: '1' },
            { unitCode: 'crate', factor: '5' },
            { unitCode: 'tin', factor: '1e3' },
          ],
        }),
      );
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_PURCHASE_UNITS');
      expect(res.body.details.issues).toEqual([
        { index: 0, unitCode: 'case', problem: 'NOT_POSITIVE' },
        { index: 1, unitCode: 'bag', problem: 'NOT_POSITIVE' },
        { index: 2, unitCode: 'sack', problem: 'TOO_MANY_DECIMALS' },
        { index: 3, unitCode: 'kg', problem: 'SAME_AS_BASE_UNIT' },
        { index: 4, unitCode: 'crate', problem: 'UNKNOWN_UNIT' },
        { index: 5, unitCode: 'tin', problem: 'NOT_A_NUMBER' },
      ]);
    });

    it('writes nothing when it refuses: no item, no version, no audit entry', async () => {
      const before = await changesSince(0, 1);
      const code = uniqueCode('REFUSED');
      await as(admin).post(
        '/items',
        newItem({ code, purchaseUnits: [{ unitCode: 'case', factor: '0' }] }),
      );
      expect((await changesSince(0, 1)).latestVersion).toBe(before.latestVersion);
      const list = await as(admin).get('/items').query({ q: code, status: 'all' });
      expect(list.body).toEqual([]);
    });
  });

  describe('editing an item', () => {
    it('changes the given fields, takes a new version and records exactly what changed', async () => {
      const item = await create();
      const res = await as(admin)
        .patch(`/items/${item.id}`, {
          version: item.version,
          nameEn: 'Chicken wing tip',
          shelfLifeDays: 2,
          purchaseUnits: [
            { unitCode: 'case', factor: '12' },
            { unitCode: 'bag', factor: '2.5' },
          ],
        })
        .set('x-request-id', 'e2e-item-edit-01');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        code: item.code,
        nameTh: item.nameTh,
        nameEn: 'Chicken wing tip',
        shelfLifeDays: 2,
        purchaseUnits: [
          { unitCode: 'bag', factor: '2.5' },
          { unitCode: 'case', factor: '12' },
        ],
      });
      expect(res.body.version).toBeGreaterThan(item.version);

      const { changes } = await changesSince(item.version);
      const change = changes.find((c: Body) => c.entityId === item.id);
      expect(change).toMatchObject({ version: res.body.version, action: 'updated' });
      expect(change.data).toMatchObject({ nameEn: 'Chicken wing tip', version: res.body.version });

      const entries = await auditOf(item.id);
      expect(entries.at(-1)).toMatchObject({
        action: 'UPDATE',
        summary: `Updated item ${item.code} (Chicken wing tip)`,
        correlationId: 'e2e-item-edit-01',
        changes: {
          nameEn: { from: 'Chicken wingette', to: 'Chicken wing tip' },
          shelfLifeDays: { from: 3, to: 2 },
          purchaseUnits: {
            from: [{ unitCode: 'case', factor: '10' }],
            to: [
              { unitCode: 'bag', factor: '2.5' },
              { unitCode: 'case', factor: '12' },
            ],
          },
        },
      });
    });

    it('records nothing and keeps the version when nothing changes', async () => {
      const item = await create();
      const res = await as(admin).patch(`/items/${item.id}`, {
        version: item.version,
        nameEn: item.nameEn,
        purchaseUnits: [{ unitCode: 'case', factor: '10.0' }],
      });
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(item.version);
      expect(await auditOf(item.id)).toHaveLength(1);
    });

    it('refuses an edit made from a stale version, so nobody silently undoes another', async () => {
      const item = await create();
      const first = await as(admin).patch(`/items/${item.id}`, {
        version: item.version,
        nameEn: 'First edit',
      });
      expect(first.status).toBe(200);

      const stale = await as(admin).patch(`/items/${item.id}`, {
        version: item.version,
        nameEn: 'Second edit, from the old screen',
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('ITEM_CHANGED');
      expect(stale.body.details).toEqual({ currentVersion: first.body.version });
    });

    it.each([
      ['the code', { code: 'NEW-CODE' }],
      ['the base unit', { baseUnitCode: 'piece' }],
      ['no version', { version: undefined, nameEn: 'x' }],
    ])('refuses to change %s (400)', async (_name, body) => {
      const item = await create();
      const res = await as(admin).patch(`/items/${item.id}`, { version: item.version, ...body });
      expect(res.status).toBe(400);
    });

    it('checks purchase units against the base unit it already has', async () => {
      const item = await create({
        baseUnitCode: 'piece',
        variableWeight: false,
        purchaseUnits: [],
      });
      const res = await as(admin).patch(`/items/${item.id}`, {
        version: item.version,
        purchaseUnits: [{ unitCode: 'piece', factor: '1' }],
      });
      expect(res.status).toBe(422);
      expect(res.body.details.issues).toEqual([
        { index: 0, unitCode: 'piece', problem: 'SAME_AS_BASE_UNIT' },
      ]);
    });

    it('is 404 for an item that does not exist', async () => {
      const res = await as(admin).patch('/items/00000000-0000-4000-8000-000000000000', {
        version: 1,
        nameEn: 'x',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('deactivating an item', () => {
    it('keeps it, hides it from the default list, and logs it as a change', async () => {
      const item = await create();
      const res = await as(admin).patch(`/items/${item.id}`, {
        version: item.version,
        active: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);

      const active = await as(branchManager).get('/items').query({ q: item.code });
      expect(active.body).toEqual([]);
      const inactive = await as(branchManager)
        .get('/items')
        .query({ q: item.code, status: 'inactive' });
      expect(inactive.body.map((i: Body) => i.id)).toEqual([item.id]);
      expect((await as(branchManager).get(`/items/${item.id}`)).body.active).toBe(false);

      const { changes } = await changesSince(item.version);
      expect(changes.find((c: Body) => c.entityId === item.id).data.active).toBe(false);
      expect((await auditOf(item.id)).at(-1)).toMatchObject({
        summary: `Deactivated item ${item.code} (${item.nameEn})`,
        changes: { active: { from: true, to: false } },
      });

      const back = await as(admin).patch(`/items/${item.id}`, {
        version: res.body.version,
        active: true,
      });
      expect(back.body.active).toBe(true);
      expect((await auditOf(item.id)).at(-1)?.summary).toMatch(/^Reactivated item/);
    });

    it('never deletes: there is no DELETE route', async () => {
      const item = await create();
      const res = await as(admin).delete(`/items/${item.id}`);
      expect(res.status).toBe(404);
      expect((await as(admin).get(`/items/${item.id}`)).status).toBe(200);
    });
  });

  describe('who may do what', () => {
    it('lets anyone signed in read items', async () => {
      const item = await create();
      expect((await as(branchManager).get('/items')).status).toBe(200);
      expect((await as(branchManager).get(`/items/${item.id}`)).body.code).toBe(item.code);
    });

    it('refuses reads without a session', async () => {
      expect((await as(null).get('/items')).status).toBe(401);
      expect((await as(null).get('/master-data/changes')).status).toBe(401);
    });

    it('lets only the admin role change items', async () => {
      const item = await create();
      const created = await as(branchManager).post('/items', newItem());
      expect(created.status).toBe(403);
      const edited = await as(branchManager).patch(`/items/${item.id}`, {
        version: item.version,
        active: false,
      });
      expect(edited.status).toBe(403);
      expect((await as(null).post('/items', newItem())).status).toBe(401);
    });
  });

  describe('searching', () => {
    it('matches the code or either name, ignoring case', async () => {
      const item = await create({ nameTh: 'ไก่ป๊อปทดสอบ', nameEn: 'Popcorn test chicken' });
      for (const q of [item.code.toLowerCase(), 'ป๊อปทดสอบ', 'POPCORN TEST']) {
        const res = await as(branchManager).get('/items').query({ q });
        expect(res.body.map((i: Body) => i.id)).toEqual([item.id]);
      }
    });
  });

  describe('the change log', () => {
    it('pages through changes in version order', async () => {
      const start = (await changesSince(0, 1)).latestVersion;
      const made = [await create(), await create(), await create()];

      const page1 = await changesSince(start, 2);
      expect(page1.hasMore).toBe(true);
      expect(page1.changes.map((c: Body) => c.entityId)).toEqual([made[0].id, made[1].id]);
      const page2 = await changesSince(page1.changes.at(-1)?.version, 2);
      expect(page2.hasMore).toBe(false);
      expect(page2.changes.map((c: Body) => c.entityId)).toEqual([made[2].id]);
      expect(page2.latestVersion).toBe(made[2].version);
    });

    it('returns nothing new to a caller that is up to date', async () => {
      const { latestVersion } = await changesSince(0, 1);
      expect(await changesSince(latestVersion)).toEqual({
        latestVersion,
        changes: [],
        hasMore: false,
      });
    });

    it('refuses a negative or non-numeric version', async () => {
      for (const since of ['-1', 'abc']) {
        const res = await as(branchManager).get('/master-data/changes').query({ since });
        expect(res.status).toBe(400);
      }
    });

    it('hands out strictly increasing versions, with no gaps, under concurrent writes', async () => {
      const start = (await changesSince(0, 1)).latestVersion;
      const target = await create();
      // Forty requests in flight on one server, each adding its own error listener.
      ctx.server.setMaxListeners(50);

      // Twenty creates and twenty edits of one item at once: the edits race for the same
      // row and the creates for the counter.
      const creates = Array.from({ length: 20 }, () => as(admin).post('/items', newItem()));
      let version = target.version;
      const edits = Array.from({ length: 20 }, (_, n) =>
        as(admin).patch(`/items/${target.id}`, { version, nameEn: `Concurrent ${n}` }),
      );
      const results = await Promise.all([...creates, ...edits]);
      expect(results.slice(0, 20).map((r) => r.status)).toEqual(Array(20).fill(201));
      // Exactly one edit wins its version; the rest see ITEM_CHANGED rather than overwriting.
      const editStatuses = results.slice(20).map((r) => r.status);
      expect(editStatuses.filter((s) => s === 200)).toHaveLength(1);
      expect(editStatuses.filter((s) => s === 409)).toHaveLength(19);
      version = results.slice(20).find((r) => r.status === 200)!.body.version;

      const { changes, latestVersion } = await changesSince(start, 1000);
      const versions = changes.map((c: Body) => c.version);
      expect(versions).toHaveLength(22);
      expect(versions).toEqual(Array.from({ length: 22 }, (_, i) => start + 1 + i));
      expect(latestVersion).toBe(start + 22);

      // Each item's own version is the version of its latest change.
      const created = results.slice(0, 20).map((r) => r.body);
      for (const item of created) {
        expect(changes.find((c: Body) => c.entityId === item.id).version).toBe(item.version);
      }
      expect(changes.filter((c: Body) => c.entityId === target.id).at(-1)?.version).toBe(version);
    });
  });
});

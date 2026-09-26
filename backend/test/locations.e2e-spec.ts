// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Locations and suppliers (#6), end to end: the code format, a code corrected before its
 * first use and refused after it, superseding, in-transit locations the system alone
 * manages, branches in the master data change log, suppliers, who may do what, the audit
 * entry of each change and the `location_code` label on the request's log line.
 */
import request from 'supertest';
import { DEMO_LOCATIONS, DEMO_SUPPLIERS } from '../prisma/seed';
import { LocationsService } from 'src/modules/locations/locations.service';
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

let counter = 0;
const uniqueCode = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${counter}`;
};

describe('locations and suppliers', () => {
  let ctx: TestContext;
  let admin: Session;
  let purchasing: Session;
  let finance: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
    purchasing = await signIn(ctx.server, demoEmail('purchasing'));
    finance = await signIn(ctx.server, demoEmail('finance'));
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

  const newLocation = (overrides: Body = {}) => ({
    code: uniqueCode('BR'),
    type: 'branch',
    nameTh: 'สาขาทดสอบ',
    nameEn: 'Test branch',
    ...overrides,
  });

  const create = async (overrides: Body = {}): Promise<Body> => {
    const res = await as(admin).post('/locations', newLocation(overrides));
    expect(res.status).toBe(201);
    return res.body;
  };

  const auditOf = async (id: string): Promise<Body[]> => {
    const res = await as(admin)
      .get('/audit-logs')
      .query({ entityType: 'Location', entityId: id, sortOrder: 'asc' });
    return res.body.data;
  };

  const changesSince = async (since: number): Promise<Body> =>
    (await as(finance).get('/master-data/changes').query({ since, limit: 1000 })).body;

  const latestVersion = async (): Promise<number> =>
    (await as(finance).get('/master-data/changes').query({ since: 0, limit: 1 })).body
      .latestVersion;

  /** What a posted document or a POS pull will do from #8 on: fix the location's code. */
  const useLocation = async (id: string, use: string) => {
    const prisma = ctx.app.get(PrismaService);
    await prisma.$transaction((tx) => ctx.app.get(LocationsService).markFirstUse(tx, [id], use));
  };

  const completedLine = (requestId: string) =>
    ctx
      .logs()
      .find(
        (l) =>
          l.labels?.event === 'http.request.completed' && l.labels?.correlation_id === requestId,
      );

  describe('the demo seed', () => {
    it("adds the chain's plant, its in-transit location, three branches and two suppliers", async () => {
      const res = await as(finance).get('/locations').query({ status: 'all' });
      const codes = res.body.map((l: Body) => l.code);
      for (const demo of DEMO_LOCATIONS) expect(codes).toContain(demo.code);
      const plant = res.body.find((l: Body) => l.code === 'PLANT-01');
      expect(plant.inTransit.code).toBe('IN-TRANSIT:PLANT-01');
      const branches = res.body.filter(
        (l: Body) => l.type === 'branch' && l.code.startsWith('BR-'),
      );
      expect(branches.map((b: Body) => b.code)).toEqual(
        expect.arrayContaining(['BR-SILOM', 'BR-ARI', 'BR-BANGNA']),
      );

      const suppliers = await as(finance).get('/suppliers');
      for (const demo of DEMO_SUPPLIERS) {
        expect(suppliers.body.map((s: Body) => s.code)).toContain(demo.code);
      }
    });
  });

  describe('creating a location', () => {
    it('creates a branch with an audit entry, a master data change and the location_code label', async () => {
      const before = await latestVersion();
      const code = uniqueCode('BR');
      const res = await as(admin)
        .post('/locations', newLocation({ code: ` ${code.toLowerCase()} ` }))
        .set('x-request-id', 'e2e-location-create-01');

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        code,
        type: 'branch',
        nameTh: 'สาขาทดสอบ',
        active: true,
        origin: null,
        inTransit: null,
        supersededBy: null,
        firstUsedAt: null,
        revision: 1,
        masterDataVersion: before + 1,
      });

      const { changes } = await changesSince(before);
      expect(changes).toEqual([
        expect.objectContaining({
          version: before + 1,
          entityType: 'location',
          entityId: res.body.id,
          entityCode: code,
          action: 'created',
          data: expect.objectContaining({ locationCode: code, type: 'branch', supersededBy: null }),
        }),
      ]);
      const [entry] = await auditOf(res.body.id);
      expect(entry).toMatchObject({
        action: 'CREATE',
        summary: `Created branch ${code} (Test branch)`,
        correlationId: 'e2e-location-create-01',
      });
      expect(completedLine('e2e-location-create-01')?.labels.location_code).toBe(code);
    });

    it('gives a plant or a warehouse its own in-transit location, and no master data change', async () => {
      const before = await latestVersion();
      const code = uniqueCode('WH');
      const warehouse = await create({
        code,
        type: 'warehouse',
        nameTh: 'คลังทดสอบ',
        nameEn: 'Test store',
      });

      expect(warehouse.masterDataVersion).toBeNull();
      expect(warehouse.inTransit.code).toBe(`IN-TRANSIT:${code}`);
      const inTransit = (await as(admin).get(`/locations/${warehouse.inTransit.id}`)).body;
      expect(inTransit).toMatchObject({
        type: 'in_transit',
        nameTh: 'ระหว่างขนส่งจาก คลังทดสอบ',
        nameEn: 'In transit from Test store',
        origin: { id: warehouse.id, code },
      });
      expect(await latestVersion()).toBe(before);
    });

    it.each([
      ['a code with a space', 'BR SILOM', 'BAD_CHARACTER'],
      ['a one-character code', 'B', 'TOO_SHORT'],
      ['a code over 32 characters', 'B'.repeat(33), 'TOO_LONG'],
      ['a code starting with a hyphen', '-SILOM', 'BAD_FIRST_CHARACTER'],
      ['a Thai code', 'สาขาสีลม', 'BAD_FIRST_CHARACTER'],
      ['the in-transit shape', 'IN-TRANSIT:X1', 'BAD_CHARACTER'],
    ])('refuses %s, saying why', async (_name, code, problem) => {
      const res = await as(admin).post('/locations', newLocation({ code }));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'INVALID_LOCATION_CODE', details: { problem } });
    });

    it('refuses a code already taken', async () => {
      const existing = await create();
      const res = await as(admin).post('/locations', newLocation({ code: existing.code }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LOCATION_CODE_TAKEN');
    });

    it('refuses an in-transit location, which only the system creates', async () => {
      const res = await as(admin).post('/locations', newLocation({ type: 'in_transit' }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('LOCATION_TYPE_SYSTEM_MANAGED');
    });

    it('refuses a subcontractor, which is reserved (ADR-0001)', async () => {
      const res = await as(admin).post('/locations', newLocation({ type: 'subcontractor' }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('LOCATION_TYPE_RESERVED');
    });

    it('refuses an unknown type', async () => {
      const res = await as(admin).post('/locations', newLocation({ type: 'kitchen' }));
      expect(res.status).toBe(400);
    });
  });

  describe('the location code', () => {
    it('can be corrected before its first use; the POS gets the change', async () => {
      const branch = await create();
      const corrected = uniqueCode('BR-FIX');
      const res = await as(admin)
        .patch(`/locations/${branch.id}`, { revision: 1, code: corrected.toLowerCase() })
        .set('x-request-id', 'e2e-location-fix-code-01');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ code: corrected, revision: 2 });
      expect(res.body.masterDataVersion).toBeGreaterThan(branch.masterDataVersion);
      const { changes } = await changesSince(branch.masterDataVersion);
      expect(changes.find((c: Body) => c.entityId === branch.id)).toMatchObject({
        action: 'updated',
        entityCode: corrected,
      });
      expect((await auditOf(branch.id)).at(-1)).toMatchObject({
        summary: `Corrected the code of branch ${branch.code} to ${corrected}`,
        changes: { locationCode: { from: branch.code, to: corrected } },
      });
      expect(completedLine('e2e-location-fix-code-01')?.labels.location_code).toBe(corrected);
    });

    it("takes its plant's in-transit location with it", async () => {
      const plant = await create({ code: uniqueCode('PL'), type: 'plant' });
      const corrected = uniqueCode('PL-FIX');
      const res = await as(admin).patch(`/locations/${plant.id}`, { revision: 1, code: corrected });
      expect(res.body.inTransit.code).toBe(`IN-TRANSIT:${corrected}`);
    });

    it('is refused after its first use, and the database refuses it too', async () => {
      const branch = await create();
      await useLocation(branch.id, 'test document TD-000001');

      const res = await as(admin).patch(`/locations/${branch.id}`, {
        revision: 1,
        code: uniqueCode('BR-LATE'),
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('LOCATION_CODE_IN_USE');
      const view = (await as(admin).get(`/locations/${branch.id}`)).body;
      expect(view).toMatchObject({ code: branch.code, firstUse: 'test document TD-000001' });
      expect(view.firstUsedAt).not.toBeNull();

      // Names still change after first use.
      const renamed = await as(admin).patch(`/locations/${branch.id}`, {
        revision: 1,
        nameEn: 'Renamed branch',
      });
      expect(renamed.status).toBe(200);

      // Not even a hand-written query can change it.
      const prisma = ctx.app.get(PrismaService);
      await expect(
        prisma.$executeRaw`UPDATE locations SET code = 'X-SNEAKY' WHERE id = ${branch.id}::uuid`,
      ).rejects.toThrow(/fixed since its first use/);
    });

    it('keeps the first use when a later one comes', async () => {
      const branch = await create();
      await useLocation(branch.id, 'test document TD-000002');
      await useLocation(branch.id, 'test document TD-000003');
      expect((await as(admin).get(`/locations/${branch.id}`)).body.firstUse).toBe(
        'test document TD-000002',
      );
    });
  });

  describe('superseding a location', () => {
    it('replaces a branch whose wrong code is in use; the POS gets the link', async () => {
      const wrong = await create({ nameEn: 'Wrong code branch' });
      await useLocation(wrong.id, 'test document TD-000004');
      const right = await create({ nameEn: 'Right code branch' });

      const res = await as(admin)
        .post(`/locations/${wrong.id}/supersede`, { revision: 1, byLocationId: right.id })
        .set('x-request-id', 'e2e-location-supersede-01');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        active: false,
        supersededBy: { id: right.id, code: right.code },
        revision: 2,
      });
      const { changes } = await changesSince(right.masterDataVersion);
      expect(changes.find((c: Body) => c.entityId === wrong.id)?.data).toMatchObject({
        active: false,
        supersededBy: { id: right.id, locationCode: right.code },
      });
      expect((await auditOf(wrong.id)).at(-1)).toMatchObject({
        summary: `Superseded ${wrong.code} by ${right.code}`,
        correlationId: 'e2e-location-supersede-01',
      });
      expect(completedLine('e2e-location-supersede-01')?.labels.location_code).toBe(wrong.code);

      // It stays out of use.
      const back = await as(admin).patch(`/locations/${wrong.id}`, { revision: 2, active: true });
      expect(back.status).toBe(422);
      expect(back.body.code).toBe('LOCATION_SUPERSEDED');
    });

    it.each<[string, { type?: string; deactivate?: boolean }, string]>([
      ['by a location of another type', { type: 'plant' }, 'SUPERSEDE_DIFFERENT_TYPE'],
      ['by an inactive location', { deactivate: true }, 'SUPERSEDE_REPLACEMENT_INACTIVE'],
    ])('refuses to supersede %s', async (_name, how, code) => {
      const old = await create();
      const by = await create(how.type ? { code: uniqueCode('PL'), type: how.type } : {});
      if (how.deactivate) {
        await as(admin).patch(`/locations/${by.id}`, { revision: 1, active: false });
      }
      const res = await as(admin).post(`/locations/${old.id}/supersede`, {
        revision: 1,
        byLocationId: by.id,
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(code);
    });

    it('refuses a location superseding itself', async () => {
      const branch = await create();
      const res = await as(admin).post(`/locations/${branch.id}/supersede`, {
        revision: 1,
        byLocationId: branch.id,
      });
      expect(res.body.code).toBe('SUPERSEDE_SAME_LOCATION');
    });
  });

  describe('in-transit locations', () => {
    it('cannot be edited, deactivated or superseded by anyone', async () => {
      const plant = await create({ code: uniqueCode('PL'), type: 'plant' });
      const inTransit = plant.inTransit;
      for (const body of [
        { revision: 1, nameEn: 'Mine now' },
        { revision: 1, active: false },
        { revision: 1, code: uniqueCode('IT') },
      ]) {
        const res = await as(admin).patch(`/locations/${inTransit.id}`, body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('LOCATION_SYSTEM_MANAGED');
      }
      const other = await create({ code: uniqueCode('PL'), type: 'plant' });
      const superseded = await as(admin).post(`/locations/${inTransit.id}/supersede`, {
        revision: 1,
        byLocationId: other.inTransit.id,
      });
      expect(superseded.body.code).toBe('LOCATION_SYSTEM_MANAGED');
    });

    it('follow their plant when it is deactivated and reactivated', async () => {
      const plant = await create({ code: uniqueCode('PL'), type: 'plant' });
      await as(admin).patch(`/locations/${plant.id}`, { revision: 1, active: false });
      expect((await as(admin).get(`/locations/${plant.inTransit.id}`)).body.active).toBe(false);
      await as(admin).patch(`/locations/${plant.id}`, { revision: 2, active: true });
      expect((await as(admin).get(`/locations/${plant.inTransit.id}`)).body.active).toBe(true);
    });
  });

  describe('editing a location', () => {
    it('refuses an edit from a stale revision', async () => {
      const branch = await create();
      await as(admin).patch(`/locations/${branch.id}`, { revision: 1, nameEn: 'First' });
      const stale = await as(admin).patch(`/locations/${branch.id}`, {
        revision: 1,
        nameEn: 'Second',
      });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({
        code: 'LOCATION_CHANGED',
        details: { currentRevision: 2 },
      });
    });

    it('refuses to change the type, and never deletes', async () => {
      const branch = await create();
      const res = await as(admin).patch(`/locations/${branch.id}`, { revision: 1, type: 'plant' });
      expect(res.status).toBe(400);
      expect((await as(admin).delete(`/locations/${branch.id}`)).status).toBe(404);
    });

    it('deactivates a branch as a master data change', async () => {
      const branch = await create();
      const res = await as(admin).patch(`/locations/${branch.id}`, { revision: 1, active: false });
      expect(res.body.active).toBe(false);
      const { changes } = await changesSince(branch.masterDataVersion);
      expect(changes.find((c: Body) => c.entityId === branch.id)?.data.active).toBe(false);
      expect((await auditOf(branch.id)).at(-1)?.summary).toBe(`Deactivated branch ${branch.code}`);
    });
  });

  describe('who may do what', () => {
    it('lets anyone signed in read locations and suppliers, and nobody without a session', async () => {
      expect((await as(finance).get('/locations')).status).toBe(200);
      expect((await as(finance).get('/suppliers')).status).toBe(200);
      expect((await as(null).get('/locations')).status).toBe(401);
      expect((await as(null).get('/suppliers')).status).toBe(401);
    });

    it('lets only admin change locations', async () => {
      const branch = await create();
      expect((await as(purchasing).post('/locations', newLocation())).status).toBe(403);
      expect(
        (await as(purchasing).patch(`/locations/${branch.id}`, { revision: 1, nameEn: 'x' }))
          .status,
      ).toBe(403);
    });
  });

  describe('suppliers', () => {
    const newSupplier = (overrides: Body = {}) => ({
      code: uniqueCode('sup'),
      name: 'บริษัท ทดสอบ จำกัด (สมมติ)',
      taxId: '0-0000-00000-00-1',
      contactName: 'ฝ่ายขาย',
      phone: '02-000-0000',
      email: 'Sales@Supplier.example',
      address: 'ที่อยู่สมมติ',
      ...overrides,
    });

    it('are created and edited by purchasing, with an audit entry for each change', async () => {
      const res = await as(purchasing)
        .post('/suppliers', newSupplier())
        .set('x-request-id', 'e2e-supplier-create-01');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        taxId: '0000000000001',
        email: 'sales@supplier.example',
        active: true,
        revision: 1,
      });
      expect(res.body.code).toMatch(/^SUP-/);

      const edited = await as(purchasing).patch(`/suppliers/${res.body.id}`, {
        revision: 1,
        phone: '',
        address: 'ที่อยู่ใหม่ (สมมติ)',
      });
      expect(edited.body).toMatchObject({
        phone: null,
        address: 'ที่อยู่ใหม่ (สมมติ)',
        revision: 2,
      });

      const audit = await as(admin)
        .get('/audit-logs')
        .query({ entityType: 'Supplier', entityId: res.body.id, sortOrder: 'asc' });
      expect(audit.body.data.map((e: Body) => e.action)).toEqual(['CREATE', 'UPDATE']);
      expect(audit.body.data[1].changes).toEqual({
        phone: { from: '02-000-0000', to: null },
        address: { from: 'ที่อยู่สมมติ', to: 'ที่อยู่ใหม่ (สมมติ)' },
      });
    });

    it.each([
      ['12 digits', '000000000001', 'NOT_13_DIGITS'],
      ['a mistyped digit', '0000000000002', 'CHECK_DIGIT'],
      ['letters', 'ABCDEFGHIJKLM', 'NOT_13_DIGITS'],
    ])('refuse a tax id with %s', async (_name, taxId, problem) => {
      const res = await as(purchasing).post('/suppliers', newSupplier({ taxId }));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'INVALID_TAX_ID', details: { problem } });
    });

    it('refuse a taken code, a bad email and an edit from a stale revision', async () => {
      const supplier = (await as(purchasing).post('/suppliers', newSupplier())).body;
      expect(
        (await as(purchasing).post('/suppliers', newSupplier({ code: supplier.code }))).status,
      ).toBe(409);
      expect(
        (await as(purchasing).post('/suppliers', newSupplier({ email: 'not-an-email' }))).status,
      ).toBe(400);
      await as(purchasing).patch(`/suppliers/${supplier.id}`, { revision: 1, name: 'First' });
      const stale = await as(purchasing).patch(`/suppliers/${supplier.id}`, {
        revision: 1,
        name: 'Second',
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('SUPPLIER_CHANGED');
    });

    it('are deactivated, never deleted, and stay out of the master data log', async () => {
      const before = await latestVersion();
      const supplier = (await as(admin).post('/suppliers', newSupplier())).body;
      const res = await as(admin).patch(`/suppliers/${supplier.id}`, {
        revision: 1,
        active: false,
      });
      expect(res.body.active).toBe(false);
      expect((await as(admin).get('/suppliers')).body.map((s: Body) => s.id)).not.toContain(
        supplier.id,
      );
      expect((await as(admin).delete(`/suppliers/${supplier.id}`)).status).toBe(404);
      expect(await latestVersion()).toBe(before);
    });

    it('cannot be managed by other roles', async () => {
      expect((await as(finance).post('/suppliers', newSupplier())).status).toBe(403);
    });
  });
});

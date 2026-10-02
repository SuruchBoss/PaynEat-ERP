// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Menu items, prices, modifiers and versioned recipes (#16), end to end against a real
 * PostgreSQL: the demo menu, create and edit, who may read and change what, prices from a date
 * with branch overrides, recipe versions that never overlap and never change once in force,
 * the theoretical cost at current lot costs, and every change in the master data log exactly
 * as contract 1.1 describes it.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { addDays } from 'src/core/time/domain/business-date';
import { DEMO_MENU_ITEMS, DEMO_MODIFIER_GROUPS } from '../prisma/seed';
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
const changesSchema = ajv.compile(
  JSON.parse(readFileSync(join(V1, 'master-data-changes.schema.json'), 'utf8')) as object,
);

let counter = 0;
const unique = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${counter}`;
};

describe('menu master data (#16)', () => {
  let ctx: TestContext;
  let admin: Session;
  let finance: Session;
  let branchManager: Session;
  let purchasing: Session;
  let prisma: PrismaService;
  let today: string;
  let items: Map<string, Body>;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    admin = await signInAsAdmin(ctx.server);
    finance = await signIn(ctx.server, demoEmail('finance'));
    branchManager = await signIn(ctx.server, demoEmail('branch_manager'));
    purchasing = await signIn(ctx.server, demoEmail('purchasing'));
    today = (await as(finance).get('/stock-on-hand')).body.asOf;
    const all = await as(finance).get('/items').query({ status: 'all' });
    items = new Map(all.body.map((i: Body) => [i.code, i]));
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
      put: (path: string, body: object) =>
        auth(request(ctx.server).put(`${API}${path}`).send(body)),
    };
  };

  const itemId = (code: string) => items.get(code)!.id as string;
  const latestVersion = async () =>
    (await as(branchManager).get('/master-data/changes').query({ since: 0, limit: 1 })).body
      .latestVersion as number;
  const changesSince = async (since: number): Promise<Body[]> => {
    const res = await as(branchManager).get('/master-data/changes').query({ since, limit: 1000 });
    expect(res.status).toBe(200);
    const ok = changesSchema(res.body);
    expect(changesSchema.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    return res.body.changes;
  };

  const newGroup = async (overrides: Body = {}): Promise<Body> => {
    const res = await as(admin).post('/modifier-groups', {
      code: unique('GRP'),
      nameTh: 'ระดับความเผ็ด',
      nameEn: 'Heat',
      minSelections: 0,
      maxSelections: 1,
      options: [
        { code: unique('OPT'), nameTh: 'เผ็ดมาก', nameEn: 'Extra hot', priceChange: '5' },
        { code: unique('OPT'), nameTh: 'ไม่เผ็ด', nameEn: 'Mild', priceChange: '-2.50' },
      ],
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body;
  };

  const newMenuItem = async (overrides: Body = {}): Promise<Body> => {
    const res = await as(admin).post('/menu-items', {
      code: unique('MENU'),
      nameTh: 'ไก่ป๊อป',
      nameEn: 'Popcorn chicken',
      categoryTh: 'ของทานเล่น',
      categoryEn: 'Snacks',
      soldBy: 'portion',
      modifierGroupIds: [],
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body;
  };

  describe('the demo menu', () => {
    it('is seeded with pieces, sets, a bucket and one item sold by weight', async () => {
      const res = await as(finance).get('/menu-items');
      expect(res.status).toBe(200);
      const codes = res.body.map((m: Body) => m.code);
      for (const demo of DEMO_MENU_ITEMS) expect(codes).toContain(demo.code);
      const bucket = res.body.find((m: Body) => m.code === 'BUCKET-8');
      expect(bucket).toMatchObject({ soldBy: 'portion', currentPrice: '299' });
      expect(bucket.modifierGroups.map((g: Body) => g.code)).toEqual(['FLAVOUR', 'SAUCE']);
      expect(res.body.find((m: Body) => m.code === 'FRIED-CHICKEN-BY-WEIGHT')).toMatchObject({
        soldBy: 'weight',
        currentPrice: '320',
      });

      const groups = await as(branchManager).get('/modifier-groups');
      expect(groups.status).toBe(200);
      for (const demo of DEMO_MODIFIER_GROUPS) {
        expect(groups.body.map((g: Body) => g.code)).toContain(demo.code);
      }
      const sauce = groups.body.find((g: Body) => g.code === 'SAUCE');
      expect(sauce.options.map((o: Body) => [o.code, o.priceChange])).toEqual([
        ['SAUCE-HOT', '10'],
        ['NO-SAUCE', '0'],
      ]);
    });

    it("shows the bucket's chain price, Silom's own price and next week's change", async () => {
      const list = await as(finance).get('/menu-items');
      const bucket = list.body.find((m: Body) => m.code === 'BUCKET-8');
      const detail = await as(finance).get(`/menu-items/${bucket.id}`);
      expect(detail.status).toBe(200);
      expect(
        detail.body.prices.map((p: Body) => [p.location?.code ?? null, p.price, p.status]),
      ).toEqual([
        [null, '309', 'scheduled'],
        [null, '299', 'current'],
        ['BR-SILOM', '319', 'current'],
      ]);
    });

    it('prices the recipe in force at current lot costs, and says when a line has none', async () => {
      const list = await as(finance).get('/menu-items');
      const byWeight = list.body.find((m: Body) => m.code === 'FRIED-CHICKEN-BY-WEIGHT');
      const recipe = await as(finance).get(`/menu-items/${byWeight.id}/recipe`);
      expect(recipe.status).toBe(200);
      expect(recipe.body.subject).toMatchObject({ kind: 'menu', per: 'kg' });
      const [current] = recipe.body.versions;
      expect(current).toMatchObject({ number: 1, status: 'current' });
      expect(current.lines.map((l: Body) => [l.item.code, l.quantity])).toEqual([
        ['WHOLE-CHICKEN', '1.25'],
        ['FLOUR', '0.15'],
        ['FRYING-OIL', '0.08'],
      ]);
      for (const line of current.lines) {
        expect(line.unitCost).not.toBeNull();
        expect(line.costLot).toMatch(/\//);
        expect(Number(line.cost)).toBeCloseTo(Number(line.quantity) * Number(line.unitCost), 6);
      }
      expect(current.theoreticalCost.complete).toBe(true);
      expect(Number(current.theoreticalCost.total)).toBeCloseTo(
        current.lines.reduce((sum: number, l: Body) => sum + Number(l.cost), 0),
        6,
      );

      const set = list.body.find((m: Body) => m.code === 'SET-2PC');
      const setRecipe = await as(finance).get(`/menu-items/${set.id}/recipe`);
      expect(setRecipe.body.versions.map((v: Body) => [v.number, v.status])).toEqual([
        [2, 'scheduled'],
        [1, 'current'],
      ]);
      for (const version of setRecipe.body.versions) {
        const costed = version.lines.filter((l: Body) => l.cost !== null);
        expect(version.theoreticalCost.complete).toBe(costed.length === version.lines.length);
        expect(Number(version.theoreticalCost.total)).toBeCloseTo(
          costed.reduce((sum: number, l: Body) => sum + Number(l.cost), 0),
          6,
        );
      }
    });
  });

  describe('who may read and change it', () => {
    it('lets admin, finance and branch managers read, and nobody else', async () => {
      expect((await as(admin).get('/menu-items')).status).toBe(200);
      expect((await as(finance).get('/menu-items')).status).toBe(200);
      expect((await as(branchManager).get('/modifier-groups')).status).toBe(200);
      expect((await as(purchasing).get('/menu-items')).status).toBe(403);
      expect((await as(purchasing).get('/modifier-groups')).status).toBe(403);
      expect((await as(null).get('/menu-items')).status).toBe(401);
    });

    it('lets only admin change it', async () => {
      const body = {
        code: unique('MENU'),
        nameTh: 'x',
        nameEn: 'x',
        categoryTh: 'x',
        categoryEn: 'x',
        soldBy: 'portion',
        modifierGroupIds: [],
      };
      expect((await as(finance).post('/menu-items', body)).status).toBe(403);
      expect((await as(branchManager).post('/menu-items', body)).status).toBe(403);
      const item = await newMenuItem();
      expect(
        (
          await as(finance).post(`/menu-items/${item.id}/prices`, {
            effectiveFrom: today,
            price: '10',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await as(branchManager).post(`/menu-items/${item.id}/recipe-versions`, {
            effectiveFrom: today,
            lines: [{ itemId: itemId('FLOUR'), quantity: '0.1' }],
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('menu items', () => {
    it('creates one with its modifier groups, logged and audited', async () => {
      const group = await newGroup();
      const before = await latestVersion();
      const item = await newMenuItem({
        code: unique('menu').toLowerCase(),
        modifierGroupIds: [group.id],
      });
      expect(item.code).toMatch(/^MENU-/);
      expect(item).toMatchObject({ active: true, currentPrice: null, prices: [] });
      expect(item.modifierGroups).toEqual([
        { id: group.id, code: group.code, nameTh: group.nameTh, nameEn: group.nameEn },
      ]);

      const [change] = (await changesSince(before)).filter((c) => c.entityId === item.id);
      expect(change).toMatchObject({
        entityType: 'menu_item',
        entityCode: item.code,
        action: 'created',
        data: { menuItemCode: item.code, soldBy: 'portion', modifierGroupCodes: [group.code] },
      });
      const audit = await as(admin)
        .get('/audit-logs')
        .query({ entityType: 'MenuItem', entityId: item.id });
      expect(audit.body.data[0].summary).toBe(`Created menu item ${item.code} (Popcorn chicken)`);
    });

    it('refuses a bad code, a code in use, and an inactive modifier group', async () => {
      expect(
        (await as(admin).post('/menu-items', { ...(await shapeOf()), code: 'bad code' })).status,
      ).toBe(400);
      const taken = await newMenuItem();
      const dup = await as(admin).post('/menu-items', { ...(await shapeOf()), code: taken.code });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('MENU_ITEM_CODE_TAKEN');

      const group = await newGroup();
      await as(admin).patch(`/modifier-groups/${group.id}`, {
        version: group.version,
        active: false,
      });
      const res = await as(admin).post('/menu-items', {
        ...(await shapeOf()),
        modifierGroupIds: [group.id],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('UNKNOWN_MODIFIER_GROUP');
    });

    it('changes names and groups, never code or how it is sold, and refuses a stale edit', async () => {
      const item = await newMenuItem();
      expect(
        (
          await as(admin).patch(`/menu-items/${item.id}`, {
            version: item.version,
            soldBy: 'weight',
          })
        ).status,
      ).toBe(400);
      const renamed = await as(admin).patch(`/menu-items/${item.id}`, {
        version: item.version,
        nameEn: 'Popcorn chicken, large',
        active: false,
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ nameEn: 'Popcorn chicken, large', active: false });
      expect(renamed.body.version).toBeGreaterThan(item.version);
      const stale = await as(admin).patch(`/menu-items/${item.id}`, {
        version: item.version,
        nameEn: 'Lost update',
      });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({
        code: 'MENU_ITEM_CHANGED',
        details: { currentVersion: renamed.body.version },
      });
      const same = await as(admin).patch(`/menu-items/${item.id}`, {
        version: renamed.body.version,
        nameEn: 'Popcorn chicken, large',
      });
      expect(same.body.version).toBe(renamed.body.version);
    });

    it('is never deleted, even by the database', async () => {
      const item = await newMenuItem();
      await expect(prisma.menuItem.delete({ where: { id: item.id } })).rejects.toThrow(
        /never deleted/,
      );
    });
  });

  describe('prices', () => {
    it('sets one from today, schedules one, overrides one branch, and logs each', async () => {
      const item = await newMenuItem();
      const silom = (await as(finance).get('/locations')).body.find(
        (l: Body) => l.code === 'BR-SILOM',
      );
      const before = await latestVersion();
      const now = await as(admin).post(`/menu-items/${item.id}/prices`, {
        effectiveFrom: today,
        price: '59.50',
      });
      expect(now.status).toBe(201);
      expect(now.body.currentPrice).toBe('59.5');
      await as(admin).post(`/menu-items/${item.id}/prices`, {
        effectiveFrom: addDays(today, 3),
        price: '65',
      });
      const branch = await as(admin).post(`/menu-items/${item.id}/prices`, {
        locationId: silom.id,
        effectiveFrom: today,
        price: '69',
      });
      expect(
        branch.body.prices.map((p: Body) => [p.location?.code ?? null, p.price, p.status]),
      ).toEqual([
        [null, '65', 'scheduled'],
        [null, '59.5', 'current'],
        ['BR-SILOM', '69', 'current'],
      ]);

      const logged = (await changesSince(before)).filter((c) => c.entityType === 'menu_price');
      expect(logged.map((c) => [c.data.locationCode, c.data.effectiveFrom, c.data.price])).toEqual([
        [null, today, '59.5'],
        [null, addDays(today, 3), '65'],
        ['BR-SILOM', today, '69'],
      ]);
    });

    it('corrects a scheduled price until its day, and never one that has started', async () => {
      const item = await newMenuItem();
      await as(admin).post(`/menu-items/${item.id}/prices`, { effectiveFrom: today, price: '40' });
      const scheduled = await as(admin).post(`/menu-items/${item.id}/prices`, {
        effectiveFrom: addDays(today, 2),
        price: '45',
      });
      const before = await latestVersion();
      const corrected = await as(admin).post(`/menu-items/${item.id}/prices`, {
        effectiveFrom: addDays(today, 2),
        price: '44',
      });
      expect(corrected.body.prices).toHaveLength(scheduled.body.prices.length);
      const [change] = await changesSince(before);
      expect(change).toMatchObject({
        entityType: 'menu_price',
        action: 'updated',
        data: { price: '44' },
      });

      const started = await as(admin).post(`/menu-items/${item.id}/prices`, {
        effectiveFrom: today,
        price: '41',
      });
      expect(started.status).toBe(409);
      expect(started.body.code).toBe('PRICE_IN_EFFECT');
    });

    it('refuses the past, a negative or over-precise price, and a plant', async () => {
      const item = await newMenuItem();
      const past = await as(admin).post(`/menu-items/${item.id}/prices`, {
        effectiveFrom: addDays(today, -1),
        price: '40',
      });
      expect(past.status).toBe(422);
      expect(past.body).toMatchObject({
        code: 'EFFECTIVE_FROM_IN_PAST',
        details: { earliest: today },
      });
      for (const price of ['-1', '40.005', 'forty']) {
        const res = await as(admin).post(`/menu-items/${item.id}/prices`, {
          effectiveFrom: today,
          price,
        });
        expect([price, res.status, res.body.code]).toEqual([price, 422, 'INVALID_PRICE']);
      }
      const plant = (await as(finance).get('/locations')).body.find(
        (l: Body) => l.code === 'PLANT-01',
      );
      const res = await as(admin).post(`/menu-items/${item.id}/prices`, {
        locationId: plant.id,
        effectiveFrom: today,
        price: '40',
      });
      expect(res.body.code).toBe('NOT_A_BRANCH');
      const bad = await as(admin).post(`/menu-items/${item.id}/prices`, {
        effectiveFrom: '2026-02-30',
        price: '40',
      });
      expect(bad.body.code).toBe('INVALID_DATE');
    });
  });

  describe('recipe versions', () => {
    const lines = (flour: string) => [
      { itemId: itemId('CHICKEN-BREAST'), quantity: '1' },
      { itemId: itemId('FLOUR'), quantity: flour },
    ];

    it('starts today, then tomorrow at the earliest, and never two on one day', async () => {
      const item = await newMenuItem();
      const first = await as(admin).post(`/menu-items/${item.id}/recipe-versions`, {
        effectiveFrom: today,
        lines: lines('0.03'),
      });
      expect(first.status).toBe(201);
      expect(first.body.versions.map((v: Body) => [v.number, v.effectiveFrom, v.status])).toEqual([
        [1, today, 'current'],
      ]);

      const sameDay = await as(admin).post(`/menu-items/${item.id}/recipe-versions`, {
        effectiveFrom: today,
        lines: lines('0.04'),
      });
      expect(sameDay.status).toBe(422);
      expect(sameDay.body).toMatchObject({
        code: 'RECIPE_TOO_EARLY',
        details: { earliest: addDays(today, 1) },
      });

      await as(admin).post(`/menu-items/${item.id}/recipe-versions`, {
        effectiveFrom: addDays(today, 5),
        lines: lines('0.05'),
      });
      const overlap = await as(admin).post(`/menu-items/${item.id}/recipe-versions`, {
        effectiveFrom: addDays(today, 5),
        lines: lines('0.06'),
      });
      expect(overlap.status).toBe(409);
      expect(overlap.body.code).toBe('RECIPE_VERSION_OVERLAP');

      const between = await as(admin).post(`/menu-items/${item.id}/recipe-versions`, {
        effectiveFrom: addDays(today, 2),
        lines: lines('0.04'),
      });
      expect(between.body.versions.map((v: Body) => [v.number, v.status])).toEqual([
        [2, 'scheduled'],
        [3, 'scheduled'],
        [1, 'current'],
      ]);
    });

    it('corrects a version before it starts, and never one in force', async () => {
      const item = await newMenuItem();
      const created = await as(admin).post(`/menu-items/${item.id}/recipe-versions`, {
        effectiveFrom: today,
        lines: lines('0.03'),
      });
      const next = await as(admin).post(`/menu-items/${item.id}/recipe-versions`, {
        effectiveFrom: addDays(today, 1),
        lines: lines('0.03'),
      });
      const scheduled = next.body.versions.find((v: Body) => v.status === 'scheduled');
      const before = await latestVersion();
      const fixed = await as(admin).put(`/recipe-versions/${scheduled.id}/lines`, {
        lines: lines('0.035'),
      });
      expect(fixed.status).toBe(200);
      const [change] = await changesSince(before);
      expect(change).toMatchObject({
        entityType: 'menu_recipe',
        action: 'updated',
        data: { number: 2, lines: [{ itemCode: 'CHICKEN-BREAST' }, { quantity: '0.035' }] },
      });

      const current = created.body.versions[0];
      const refused = await as(admin).put(`/recipe-versions/${current.id}/lines`, {
        lines: lines('0.01'),
      });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('RECIPE_VERSION_IN_EFFECT');
    });

    it('refuses bad lines, all at once, by line number', async () => {
      const item = await newMenuItem();
      const res = await as(admin).post(`/menu-items/${item.id}/recipe-versions`, {
        effectiveFrom: today,
        lines: [
          { itemId: itemId('FLOUR'), quantity: '0' },
          { itemId: itemId('CHICKEN-WING'), quantity: '1.5' },
          { itemId: itemId('FLOUR'), quantity: '0.1' },
          { itemId: '00000000-0000-4000-8000-000000000000', quantity: '1' },
        ],
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'INVALID_RECIPE_LINES',
        details: {
          issues: [
            { lineNo: 1, problem: 'not_positive' },
            { lineNo: 2, problem: 'too_many_decimals' },
            { lineNo: 3, problem: 'duplicate_item' },
            { lineNo: 4, problem: 'unknown_item' },
          ],
        },
      });
    });

    it('lets a modifier recipe remove an item, per unit sold, logged as a modifier recipe', async () => {
      const group = await newGroup();
      const option = group.options[1];
      const before = await latestVersion();
      const res = await as(admin).post(`/modifier-options/${option.id}/recipe-versions`, {
        effectiveFrom: today,
        lines: [{ itemId: itemId('DIPPING-SAUCE'), quantity: '-1' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.subject).toMatchObject({
        kind: 'modifier',
        code: option.code,
        per: 'unit_sold',
      });
      const [change] = await changesSince(before);
      expect(change).toMatchObject({
        entityType: 'modifier_recipe',
        entityCode: option.code,
        data: {
          modifierCode: option.code,
          lines: [{ itemCode: 'DIPPING-SAUCE', quantity: '-1', unitCode: 'piece' }],
        },
      });
    });
  });

  describe('modifier groups', () => {
    it('travel with all their options, which are never removed', async () => {
      const group = await newGroup();
      const before = await latestVersion();
      const removed = await as(admin).patch(`/modifier-groups/${group.id}`, {
        version: group.version,
        options: [input(group.options[0])],
      });
      expect(removed.status).toBe(422);
      expect(removed.body).toMatchObject({
        code: 'MODIFIER_OPTION_REMOVED',
        details: { codes: [group.options[1].code] },
      });

      const added = unique('OPT');
      const updated = await as(admin).patch(`/modifier-groups/${group.id}`, {
        version: group.version,
        options: [
          { ...input(group.options[1]), active: false },
          input(group.options[0]),
          { code: added, nameTh: 'เผ็ดน้อย', nameEn: 'Medium', priceChange: '0' },
        ],
      });
      expect(updated.status).toBe(200);
      expect(updated.body.options.map((o: Body) => [o.code, o.active])).toEqual([
        [group.options[1].code, false],
        [group.options[0].code, true],
        [added, true],
      ]);
      const [change] = await changesSince(before);
      expect(change).toMatchObject({ entityType: 'modifier_group', action: 'updated' });
      expect(change.data.options.map((o: Body) => o.modifierCode)).toEqual([
        group.options[1].code,
        group.options[0].code,
        added,
      ]);
    });

    it('keep option codes unique across groups, and selections reachable', async () => {
      const first = await newGroup();
      const res = await as(admin).post('/modifier-groups', {
        code: unique('GRP'),
        nameTh: 'x',
        nameEn: 'x',
        minSelections: 0,
        maxSelections: 1,
        options: [{ code: first.options[0].code, nameTh: 'x', nameEn: 'x', priceChange: '0' }],
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MODIFIER_CODE_TAKEN');
      const group = await as(admin).post('/modifier-groups', {
        code: first.code,
        nameTh: 'x',
        nameEn: 'x',
        minSelections: 0,
        maxSelections: 1,
        options: [{ code: unique('OPT'), nameTh: 'x', nameEn: 'x', priceChange: '0' }],
      });
      expect(group.body.code).toBe('MODIFIER_GROUP_CODE_TAKEN');

      const unreachable = await as(admin).patch(`/modifier-groups/${first.id}`, {
        version: first.version,
        minSelections: 3,
        maxSelections: 3,
      });
      expect(unreachable.status).toBe(422);
      expect(unreachable.body.code).toBe('INVALID_SELECTIONS');
    });
  });

  /** An option as the API shows it, as the API takes it back: everything but its id. */
  function input(option: Body): Body {
    const { id: _id, ...rest } = option;
    return rest;
  }

  /** A valid new menu item's fields, for tests that change one of them. */
  async function shapeOf(): Promise<Body> {
    return {
      code: unique('MENU'),
      nameTh: 'ไก่ป๊อป',
      nameEn: 'Popcorn chicken',
      categoryTh: 'ของทานเล่น',
      categoryEn: 'Snacks',
      soldBy: 'portion',
      modifierGroupIds: [],
    };
  }
});

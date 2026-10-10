// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Branch consumption (#17, ADR-0030), end to end against a real PostgreSQL: a sale delivered by a
 * POS becomes exactly one posted document, taking its recipe's ingredients from the branch's
 * lots FEFO at the sale's own time, as the automatic account; a shortfall takes the lot received
 * last (flagged when it had expired) or the item's placeholder lot; a sale dated too far ahead is
 * held, a sale whose master data is wrong fails, and a person re-processes either; two processors
 * running at once still make one document per sale; the automatic account never signs in, holds
 * no role and is not in the user list.
 */
import request from 'supertest';
import { JobLockService } from 'src/core/jobs/job-lock.service';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { APP_CONFIG } from 'src/core/config/config.token';
import type { RootConfig } from 'src/core/config/configuration';
import { addDays, dateIn } from 'src/core/time/domain/business-date';
import { LedgerService } from 'src/modules/ledger/ledger.service';
import { DEMO_POS_INSTANCE, DEMO_SALES } from '../prisma/seed';
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
const unique = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${counter}`;
};

const AUTOMATIC = 'PaynEat ERP — automatic';

describe('branch consumption', () => {
  let ctx: TestContext;
  let admin: Session;
  let plant: Session;
  let finance: Session;
  let branchManager: Session;
  let prisma: PrismaService;
  let today: string;
  const items: Record<string, Body> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
    plant = await signIn(ctx.server, demoEmail('plant'));
    finance = await signIn(ctx.server, demoEmail('finance'));
    branchManager = await signIn(ctx.server, demoEmail('branch_manager'));
    prisma = ctx.app.get(PrismaService);
    today = ctx.app.get(LedgerService).today();
    const res = await as(finance).get('/items').query({ status: 'all' });
    for (const item of res.body as Body[]) items[item.code] = item;
    // Sales events other suites left received become consumption or problems now, so every count
    // below is about this suite's own sales.
    await run();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const as = (session: Session | null, server = () => ctx.server) => {
    const auth = (req: request.Test) => (session ? req.set('Authorization', bearer(session)) : req);
    return {
      get: (path: string) => auth(request(server()).get(`${API}${path}`)),
      post: (path: string, body: object = {}) =>
        auth(request(server()).post(`${API}${path}`).send(body)),
      patch: (path: string, body: object) =>
        auth(request(server()).patch(`${API}${path}`).send(body)),
      put: (path: string, body: object) => auth(request(server()).put(`${API}${path}`).send(body)),
    };
  };

  /** A branch with a POS selling for it, and the POS's credential. */
  const newBranch = async (): Promise<{ branch: Body; pos: Body; credential: string }> => {
    const branch = await as(admin).post('/locations', {
      code: unique('BR'),
      type: 'branch',
      nameTh: 'สาขาทดสอบ',
      nameEn: 'Test branch',
    });
    expect(branch.status).toBe(201);
    const pos = await as(admin).post('/pos-instances', {
      code: unique('POS'),
      name: 'Front counter',
      branchCodes: [branch.body.code],
    });
    expect(pos.status).toBe(201);
    return { branch: branch.body, pos: pos.body.instance, credential: pos.body.credential };
  };

  /** Brings lots into a location with a posted opening balance. */
  const stockUp = async (locationId: string, lines: Body[], businessDate = today) => {
    const draft = await as(plant).post('/opening-balances', { locationId, lines, businessDate });
    expect(draft.status).toBe(201);
    const posted = await as(plant).post(`/opening-balances/${draft.body.id}/post`, {
      revision: draft.body.revision,
    });
    expect(posted.status).toBe(200);
    return posted.body;
  };
  const lot = (code: string, quantity: string, unitCost: string, expiryDate: string): Body => ({
    itemId: items[code].id,
    quantity,
    unitCost,
    expiryDate,
  });

  /** A sale line as a POS sends it, paid a moment ago unless said otherwise. */
  const sale = (at: { pos: Body; branch: Body }, overrides: Body = {}): Body => ({
    schemaVersion: 1,
    idempotencyKey: unique(`${at.pos.code}-line`),
    posInstance: at.pos.code,
    branchCode: at.branch.code,
    saleTime: new Date(Date.now() - 1000).toISOString(),
    menuItemCode: 'SET-WINGS-6',
    quantity: '2',
    modifiers: [{ code: 'SAUCE-HOT', quantity: '1' }],
    ...overrides,
  });
  const deliver = async (credential: string, body: Body): Promise<string> => {
    const res = await request(ctx.server)
      .post(`${API}/sales-events`)
      .set('Authorization', `Bearer ${credential}`)
      .send(body);
    expect(res.status).toBe(201);
    const stored = await prisma.salesEvent.findUniqueOrThrow({
      where: { idempotencyKey: body.idempotencyKey },
      select: { id: true },
    });
    return stored.id;
  };
  const run = async (server = () => ctx.server): Promise<Body> => {
    const res = await as(admin, server).post('/branch-consumption/run');
    expect(res.status).toBe(200);
    return res.body;
  };
  const consumptionOf = (salesEventId: string) =>
    prisma.branchConsumption.findMany({ where: { salesEventId } });
  const documentOf = async (salesEventId: string): Promise<Body> => {
    const [row] = await consumptionOf(salesEventId);
    expect(row).toBeDefined();
    const res = await as(finance).get(`/branch-consumption/${row.documentId}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const statusOf = async (salesEventId: string) =>
    (await prisma.salesEvent.findUniqueOrThrow({ where: { id: salesEventId } })).status;
  const problemOf = async (salesEventId: string): Promise<Body | undefined> => {
    const res = await as(branchManager).get('/branch-consumption/problems');
    expect(res.status).toBe(200);
    return (res.body as Body[]).find((p) => p.salesEventId === salesEventId);
  };
  const metric = async (name: string, labels: Record<string, string>): Promise<number> => {
    const text = (await request(`http://127.0.0.1:${ctx.metricsPort}`).get('/metrics')).text;
    const wanted = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    const line = text
      .split('\n')
      .find((l) => l.startsWith(`${name}{`) && wanted.every((w) => l.includes(w)));
    return line ? Number(line.split(' ').pop()) : 0;
  };
  const linesFor = (event: string, key: string) =>
    ctx.logs().filter((l) => l.labels?.event === event && l.labels?.correlation_id === key);
  const line = (doc: Body, code: string): Body => doc.lines.find((l: Body) => l.item.code === code);

  describe('the demo chain', () => {
    it("has a day of sales at every branch, all consumption, and Ari's wings below zero", async () => {
      const demo = await prisma.salesEvent.findMany({
        where: { idempotencyKey: { startsWith: `${DEMO_POS_INSTANCE.code}-DEMO-` } },
        select: { id: true, status: true },
      });
      expect(demo).toHaveLength(DEMO_SALES.length);
      expect(new Set(demo.map((e) => e.status))).toEqual(new Set(['processed']));
      for (const event of demo) expect(await consumptionOf(event.id)).toHaveLength(1);

      const ari = (await as(finance).get('/locations')).body.find((l: Body) => l.code === 'BR-ARI');
      const wings = await as(finance)
        .get('/stock-on-hand')
        .query({ locationId: ari.id, itemId: items['CHICKEN-WING'].id });
      expect(wings.body.rows).toEqual([
        expect.objectContaining({ quantity: '-6', countRecommended: true }),
      ]);
    });
  });

  describe('a sale at a stocked branch', () => {
    it('becomes one posted document: FEFO lots, the sale time, the automatic account', async () => {
      const at = await newBranch();
      await stockUp(at.branch.id, [
        lot('CHICKEN-WING', '30', '6.5', addDays(today, 4)),
        lot('CHICKEN-WING', '8', '6', addDays(today, 2)),
        lot('FLOUR', '5', '32.5', addDays(today, 150)),
        lot('FRYING-OIL', '5', '58', addDays(today, 300)),
        lot('DIPPING-SAUCE', '50', '1.2', addDays(today, 120)),
      ]);
      const before = await metric('erp_sales_events_total', { outcome: 'processed' });
      const body = sale(at);
      const id = await deliver(at.credential, body);

      expect(await run()).toMatchObject({ processed: 1, failed: 0, held: 0 });
      expect(await statusOf(id)).toBe('processed');
      const doc = await documentOf(id);
      expect(doc).toMatchObject({
        status: 'posted',
        businessDate: today,
        branch: { id: at.branch.id },
        salesEvent: { id, idempotencyKey: body.idempotencyKey, posInstanceCode: at.pos.code },
        menuItem: { code: 'SET-WINGS-6' },
        shortfall: false,
        consumedExpiredLot: false,
        placeholder: false,
        postedBy: { displayName: AUTOMATIC },
      });
      // Two sets of six wings: the tray expiring first (8) first, then 4 from the next one.
      const wings = line(doc, 'CHICKEN-WING');
      expect(wings).toMatchObject({ usage: '12', quantity: '12' });
      expect(wings.lots.map((l: Body) => [l.quantity, l.unitCost])).toEqual([
        ['8', '6'],
        ['4', '6.5'],
      ]);
      // A dipping sauce per set, and one more per set for SAUCE-HOT.
      expect(line(doc, 'DIPPING-SAUCE')).toMatchObject({ quantity: '4' });
      expect(line(doc, 'FLOUR')).toMatchObject({ quantity: '0.24' });

      const entries = await prisma.ledgerEntry.findMany({ where: { documentId: doc.documentId } });
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.businessTime.toISOString()).toBe(new Date(body.saleTime).toISOString());
        expect(entry.locationId).toBe(at.branch.id);
      }

      const processed = linesFor('sales_event.processed', body.idempotencyKey);
      expect(processed).toHaveLength(1);
      expect(processed[0].labels).toMatchObject({
        pos_instance: at.pos.code,
        location_code: at.branch.code,
        document_number: doc.number,
      });
      expect(await metric('erp_sales_events_total', { outcome: 'processed' })).toBe(before + 1);
      expect(
        await metric('erp_postings_total', {
          document_type: 'branch_consumption',
          outcome: 'succeeded',
        }),
      ).toBeGreaterThan(0);

      // Delivered again, it is a duplicate; run again, nothing more is posted.
      const again = await request(ctx.server)
        .post(`${API}/sales-events`)
        .set('Authorization', `Bearer ${at.credential}`)
        .send(body);
      expect(again.body).toMatchObject({ duplicate: true, status: 'processed' });
      expect((await run()).processed).toBe(0);
      expect(await consumptionOf(id)).toHaveLength(1);

      const listed = await as(branchManager)
        .get('/branch-consumption')
        .query({ from: today, to: today, branchId: at.branch.id });
      expect(listed.status).toBe(200);
      expect(listed.body.map((d: Body) => d.idempotencyKey)).toEqual([body.idempotencyKey]);
    });

    it('sold by weight, uses the recipe per kilogram', async () => {
      const at = await newBranch();
      await stockUp(at.branch.id, [
        { ...lot('WHOLE-CHICKEN', '10', '72', addDays(today, 3)), secondaryQuantity: '6' },
        lot('FLOUR', '5', '32.5', addDays(today, 150)),
        lot('FRYING-OIL', '5', '58', addDays(today, 300)),
      ]);
      const id = await deliver(
        at.credential,
        sale(at, {
          menuItemCode: 'FRIED-CHICKEN-BY-WEIGHT',
          quantity: undefined,
          weightKg: '0.8',
          modifiers: [],
        }),
      );
      expect((await run()).processed).toBe(1);
      const doc = await documentOf(id);
      expect(line(doc, 'WHOLE-CHICKEN')).toMatchObject({ usage: '1', quantity: '1' });
      expect(line(doc, 'FLOUR')).toMatchObject({ usage: '0.12', quantity: '0.12' });
    });
  });

  describe('a branch short of stock', () => {
    it('takes what is missing from the lot it received last, below zero, flagged', async () => {
      const at = await newBranch();
      await stockUp(at.branch.id, [
        lot('CHICKEN-WING', '5', '6', addDays(today, 3)),
        lot('FLOUR', '5', '32.5', addDays(today, 150)),
        lot('FRYING-OIL', '5', '58', addDays(today, 300)),
        lot('DIPPING-SAUCE', '50', '1.2', addDays(today, 120)),
      ]);
      const id = await deliver(at.credential, sale(at));
      expect((await run()).processed).toBe(1);
      const doc = await documentOf(id);
      expect(doc).toMatchObject({ shortfall: true, consumedExpiredLot: false, placeholder: false });
      expect(line(doc, 'CHICKEN-WING').lots).toHaveLength(1);
      expect(line(doc, 'CHICKEN-WING').lots[0]).toMatchObject({ quantity: '12', expired: false });

      const onHand = await as(finance)
        .get('/stock-on-hand')
        .query({ locationId: at.branch.id, itemId: items['CHICKEN-WING'].id });
      expect(onHand.status).toBe(200);
      // The branch went below zero: the stock screen asks for a count (#8, ADR-0003).
      expect(onHand.body.rows).toEqual([
        expect.objectContaining({ quantity: '-7', countRecommended: true }),
      ]);
    });

    it('takes an expired lot it received last, and says so on the document and the report', async () => {
      const at = await newBranch();
      const longAgo = addDays(today, -3);
      // Brought in three days ago, expiring that same day: nothing at the branch is usable today.
      await stockUp(at.branch.id, [lot('CHICKEN-WING', '20', '6', longAgo)], longAgo);
      const wingsOnly = await as(admin).post('/menu-items', {
        code: unique('WINGS'),
        nameTh: 'ปีกไก่',
        nameEn: 'Wings',
        categoryTh: 'ของทานเล่น',
        categoryEn: 'Snacks',
        soldBy: 'portion',
        modifierGroupIds: [],
      });
      expect(wingsOnly.status).toBe(201);
      await addRecipe(wingsOnly.body.id, [['CHICKEN-WING', '3']]);
      const id = await deliver(
        at.credential,
        sale(at, { menuItemCode: wingsOnly.body.code, modifiers: [], quantity: '1' }),
      );
      expect((await run()).processed).toBe(1);
      const doc = await documentOf(id);
      expect(doc).toMatchObject({ shortfall: true, consumedExpiredLot: true });
      expect(line(doc, 'CHICKEN-WING').lots[0]).toMatchObject({ quantity: '3', expired: true });

      const usage = await as(finance)
        .get('/branch-consumption/usage')
        .query({ from: today, to: today, branchId: at.branch.id });
      expect(usage.status).toBe(200);
      expect(usage.body).toEqual([
        expect.objectContaining({
          date: today,
          item: expect.objectContaining({ code: 'CHICKEN-WING' }),
          quantity: '3',
          value: '18',
          consumedExpiredLot: true,
          estimatedCost: false,
          unknownCost: false,
        }),
      ]);
    });

    it('sends what a branch never held to its placeholder lot, costed as an estimate', async () => {
      const at = await newBranch();
      const id = await deliver(
        at.credential,
        sale(at, { menuItemCode: 'BUCKET-8', quantity: '1' }),
      );
      expect((await run()).processed).toBe(1);
      const doc = await documentOf(id);
      expect(doc).toMatchObject({ shortfall: true, placeholder: true });
      const breast = line(doc, 'CHICKEN-BREAST');
      expect(breast.lots).toHaveLength(1);
      expect(breast.lots[0].number).toBe(`PH-${at.branch.code}-CHICKEN-BREAST`);
      expect(['estimated', 'unknown']).toContain(breast.lots[0].placeholderCost);

      // A second sale takes the same placeholder, at the cost it was given.
      const second = await deliver(
        at.credential,
        sale(at, { menuItemCode: 'BUCKET-8', quantity: '1' }),
      );
      expect((await run()).processed).toBe(1);
      const next = line(await documentOf(second), 'CHICKEN-BREAST').lots[0];
      expect(next).toMatchObject({ id: breast.lots[0].id, unitCost: breast.lots[0].unitCost });

      const onHand = await as(finance)
        .get('/stock-on-hand')
        .query({ locationId: at.branch.id, itemId: items['CHICKEN-BREAST'].id });
      expect(onHand.body.rows).toEqual([
        expect.objectContaining({
          quantity: '-4',
          lot: expect.objectContaining({ expiryDate: null }),
        }),
      ]);

      // FEFO never takes a placeholder: stock arriving later is consumed from its own lot.
      await stockUp(at.branch.id, [lot('CHICKEN-BREAST', '10', '9', addDays(today, 3))]);
      const third = await deliver(
        at.credential,
        sale(at, { menuItemCode: 'BUCKET-8', quantity: '1' }),
      );
      expect((await run()).processed).toBe(1);
      const taken = line(await documentOf(third), 'CHICKEN-BREAST').lots;
      expect(taken).toEqual([expect.objectContaining({ quantity: '2', placeholderCost: null })]);

      const usage = await as(finance)
        .get('/branch-consumption/usage')
        .query({ from: today, to: today, branchId: at.branch.id });
      const breastUsage = (usage.body as Body[]).find((r) => r.item.code === 'CHICKEN-BREAST');
      expect(breastUsage).toMatchObject({ quantity: '6' });
      expect(breastUsage!.estimatedCost || breastUsage!.unknownCost).toBe(true);
    });
  });

  const addRecipe = async (menuItemId: string, lines: Array<[string, string]>) => {
    const res = await as(admin).post(`/menu-items/${menuItemId}/recipe-versions`, {
      effectiveFrom: today,
      lines: lines.map(([code, quantity]) => ({ itemId: items[code].id, quantity })),
    });
    expect(res.status).toBe(201);
  };

  describe('a sale that cannot become consumption', () => {
    it('fails with its reason, shown and logged once, and a person re-processes it after the fix', async () => {
      const at = await newBranch();
      const code = unique('POPCORN');
      const body = sale(at, { menuItemCode: code, modifiers: [], quantity: '1' });
      const before = await metric('erp_sales_events_total', {
        outcome: 'failed',
        reason: 'unknown_menu_item',
      });
      const id = await deliver(at.credential, body);
      expect((await run()).failed).toBe(1);
      expect(await statusOf(id)).toBe('failed');
      expect(await consumptionOf(id)).toHaveLength(0);
      expect(await problemOf(id)).toMatchObject({
        outcome: 'failed',
        reason: 'unknown_menu_item',
        menuItemCode: code,
        reprocessable: true,
        notReprocessableBecause: null,
      });
      const failed = linesFor('sales_event.failed', body.idempotencyKey);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ severity: 'WARNING' });
      expect(failed[0].labels).toMatchObject({
        reason: 'unknown_menu_item',
        pos_instance: at.pos.code,
        location_code: at.branch.code,
      });
      expect(
        await metric('erp_sales_events_total', { outcome: 'failed', reason: 'unknown_menu_item' }),
      ).toBe(before + 1);

      // The processor does not try a failed event again on its own.
      expect((await run()).failed).toBe(0);

      // Only the admin re-processes; tried before the fix, it fails again and says so.
      const refused = await as(branchManager).post(
        `/branch-consumption/sales-events/${id}/reprocess`,
      );
      expect(refused.status).toBe(403);
      const early = await as(admin).post(`/branch-consumption/sales-events/${id}/reprocess`);
      expect(early.status).toBe(201);
      expect(early.body.problem).toMatchObject({ outcome: 'failed', reason: 'unknown_menu_item' });

      const created = await as(admin).post('/menu-items', {
        code,
        nameTh: 'ไก่ป๊อป',
        nameEn: 'Popcorn chicken',
        categoryTh: 'ของทานเล่น',
        categoryEn: 'Snacks',
        soldBy: 'portion',
        modifierGroupIds: [],
      });
      expect(created.status).toBe(201);
      await addRecipe(created.body.id, [['FLOUR', '0.1']]);

      const fixed = await as(admin).post(`/branch-consumption/sales-events/${id}/reprocess`);
      expect(fixed.status).toBe(201);
      expect(fixed.body).toEqual({ problem: null });
      expect(await statusOf(id)).toBe('processed');
      expect(await documentOf(id)).toMatchObject({
        postedBy: { id: admin.user.id },
        placeholder: true,
      });
      expect(await problemOf(id)).toBeUndefined();
      const history = await prisma.salesEventProcessing.findMany({
        where: { salesEventId: id },
        orderBy: { recordedAt: 'asc' },
      });
      expect(history.map((h) => h.outcome)).toEqual([
        'failed',
        'reprocessed',
        'failed',
        'reprocessed',
        'processed',
      ]);

      const twice = await as(admin).post(`/branch-consumption/sales-events/${id}/reprocess`);
      expect(twice.status).toBe(409);
      expect(twice.body.code).toBe('SALES_EVENT_PROCESSED');
    });

    it('a modifier no option has fails as unknown_modifier', async () => {
      const at = await newBranch();
      const id = await deliver(
        at.credential,
        sale(at, { modifiers: [{ code: 'NO-SUCH-MODIFIER', quantity: '1' }] }),
      );
      expect((await run()).failed).toBe(1);
      expect(await problemOf(id)).toMatchObject({
        reason: 'unknown_modifier',
        detail: { code: 'NO-SUCH-MODIFIER' },
      });
    });
  });

  describe('a sale dated ahead of its receipt', () => {
    // The company settings are shared by every suite, and the purchase-order suite checks the
    // seed left them at revision 1, so these cases use the default tolerance (10 minutes)
    // instead of changing it.
    it('is held, not failed; a person re-processes it once its date has come', async () => {
      const settings = await as(admin).get('/company/settings');
      expect(settings.body.saleTimeAheadToleranceMinutes).toBe(10);
      const outOfRange = await as(admin).patch('/company/settings', {
        revision: settings.body.revision,
        purchaseApprovalThreshold: settings.body.purchaseApprovalThreshold,
        saleTimeAheadToleranceMinutes: 1441,
      });
      expect(outOfRange.status).toBe(400);
      expect(outOfRange.body.code).toBe('VALIDATION_FAILED');

      const at = await newBranch();
      const body = sale(at, { saleTime: new Date(Date.now() + 15 * 60_000).toISOString() });
      const id = await deliver(at.credential, body);
      const outcome = await run();
      expect(outcome.held).toBe(1);
      expect(await statusOf(id)).toBe('received');
      expect(await problemOf(id)).toMatchObject({ outcome: 'held', reason: 'sale_time_ahead' });
      expect(await metric('erp_sales_events_unprocessed', { location_code: at.branch.code })).toBe(
        1,
      );

      // Held is left alone, and logged once.
      expect((await run()).held).toBe(0);
      expect(linesFor('sales_event.held', body.idempotencyKey)).toHaveLength(1);

      const saleDate = dateIn(
        ctx.app.get<RootConfig>(APP_CONFIG).app.timeZone,
        new Date(body.saleTime),
      );
      const res = await as(admin).post(`/branch-consumption/sales-events/${id}/reprocess`);
      if (saleDate > today) {
        // Within 15 minutes of midnight: its date has not come.
        expect(res.status).toBe(409);
        return;
      }
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ problem: null });
      expect(await statusOf(id)).toBe('processed');
      expect(await documentOf(id)).toMatchObject({ postedBy: { id: admin.user.id } });
    });

    it('days ahead, cannot be re-processed before its date', async () => {
      const at = await newBranch();
      const id = await deliver(
        at.credential,
        sale(at, { saleTime: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
      );
      expect((await run()).held).toBe(1);
      expect(await problemOf(id)).toMatchObject({
        reprocessable: false,
        notReprocessableBecause: 'sale_date_not_yet',
      });
      const res = await as(admin).post(`/branch-consumption/sales-events/${id}/reprocess`);
      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ block: 'sale_date_not_yet' });
      expect(await consumptionOf(id)).toHaveLength(0);
    });
  });

  describe('two processors at once', () => {
    it('still make exactly one document per sale', async () => {
      const second = await createTestApp();
      try {
        const at = await newBranch();
        await stockUp(at.branch.id, [
          lot('CHICKEN-WING', '200', '6', addDays(today, 3)),
          lot('FLOUR', '20', '32.5', addDays(today, 150)),
          lot('FRYING-OIL', '20', '58', addDays(today, 300)),
          lot('DIPPING-SAUCE', '200', '1.2', addDays(today, 120)),
        ]);
        const ids: string[] = [];
        for (let i = 0; i < 12; i += 1) ids.push(await deliver(at.credential, sale(at)));

        const [a, b] = await Promise.all([run(), run(() => second.server)]);
        expect(a.processed + b.processed).toBe(12);
        for (const id of ids) {
          expect(await consumptionOf(id)).toHaveLength(1);
          expect(await statusOf(id)).toBe('processed');
        }
        // 12 sales × 12 wings, taken once each.
        const onHand = await as(finance)
          .get('/stock-on-hand')
          .query({ locationId: at.branch.id, itemId: items['CHICKEN-WING'].id });
        expect(onHand.body.rows.map((r: Body) => r.quantity)).toEqual(['56']);
      } finally {
        await second.close();
      }
    });
  });

  describe('the processor on a timer', () => {
    it('runs on one instance at a time: the other skips its run', async () => {
      const locks = ctx.app.get(JobLockService);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      const first = locks.runExclusively('branch-consumption', () => held);
      // Give the first run time to take the lock before the second asks.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const second = await locks.runExclusively('branch-consumption', async () => undefined);
      release();
      expect([await first, second]).toEqual(['ran', 'skipped']);
    });
  });

  describe('the automatic account', () => {
    const findIt = () =>
      prisma.user.findFirstOrThrow({ where: { system: true }, select: { id: true, email: true } });

    it('never signs in, is not in the user list, and never holds a role', async () => {
      const account = await findIt();
      const login = await request(ctx.server)
        .post(`${API}/auth/login`)
        .send({ email: account.email, password: '!' });
      expect(login.status).toBe(401);

      const users = await as(admin).get('/users');
      expect(users.body.map((u: Body) => u.id)).not.toContain(account.id);
      expect((await as(admin).get(`/users/${account.id}`)).status).toBe(404);
      expect((await as(admin).put(`/users/${account.id}/roles/admin`, {})).status).toBe(404);

      await expect(
        prisma.$executeRaw`INSERT INTO "user_roles" ("user_id", "role", "granted_by_id")
          VALUES (${account.id}::uuid, 'admin', ${admin.user.id}::uuid)`,
      ).rejects.toThrow(/never holds a role/);
      await expect(
        prisma.$executeRaw`UPDATE "users" SET "password_hash" = 'x' WHERE "id" = ${account.id}::uuid`,
      ).rejects.toThrow(/users_system_unusable/);
    });
  });
});

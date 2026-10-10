// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Stock adjustments (#8), end to end against a real PostgreSQL: draft → submitted → approved →
 * posted, or rejected; nobody approves what they created, whatever roles they hold (ADR-0008);
 * a plant lot never goes below zero, even when two adjustments post at the same moment, while
 * a branch lot may, flagged for a count (ADR-0003); an expired lot is written off but never
 * increased (ADR-0006); approvals and rejections audited, refusals logged and counted.
 */
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { addDays } from 'src/core/time/domain/business-date';
import { LedgerService } from 'src/modules/ledger/ledger.service';
import { DEMO_PRODUCTION_ORDER } from '../prisma/demo-data';
import { DEMO_OPENING_BALANCE, DEMO_WRITE_OFF } from '../prisma/seed';
import {
  API,
  bearer,
  type Body,
  demoEmail,
  signIn,
  signInAsAdmin,
  TEST_PASSWORD,
  type Session,
} from './utils/auth';
import { createTestApp, type TestContext } from './utils/test-app';

let counter = 0;
const unique = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${counter}`;
};

const DOCUMENT_NUMBER = /^AD-\d{4}-\d{5}$/;

describe('stock adjustments', () => {
  let ctx: TestContext;
  let admin: Session;
  let plant: Session;
  let branchManager: Session;
  let finance: Session;
  let prisma: PrismaService;
  let today: string;
  const items: Record<string, Body> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
    plant = await signIn(ctx.server, demoEmail('plant'));
    branchManager = await signIn(ctx.server, demoEmail('branch_manager'));
    finance = await signIn(ctx.server, demoEmail('finance'));
    prisma = ctx.app.get(PrismaService);
    today = ctx.app.get(LedgerService).today();
    const res = await as(finance).get('/items').query({ status: 'all' });
    for (const item of res.body as Body[]) items[item.code] = item;
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
    };
  };

  const newLocation = async (type: 'plant' | 'branch' | 'warehouse'): Promise<Body> => {
    const res = await as(admin).post('/locations', {
      code: unique(type === 'plant' ? 'PL' : type === 'branch' ? 'BR' : 'WH'),
      type,
      nameTh: 'สถานที่ทดสอบ',
      nameEn: 'Test location',
    });
    expect(res.status).toBe(201);
    return res.body;
  };

  /** A lot of 21.6 kg (12 birds) of whole chicken at 72.5, brought in by an opening balance. */
  const chickenLot = async (
    locationId: string,
    extra: { businessDate?: string; expiryDate?: string } = {},
  ): Promise<Body> => {
    const draft = await as(plant).post('/opening-balances', {
      locationId,
      businessDate: extra.businessDate,
      lines: [
        {
          itemId: items['WHOLE-CHICKEN'].id,
          quantity: '21.6',
          secondaryQuantity: '12',
          unitCost: '72.5',
          expiryDate: extra.expiryDate ?? addDays(today, 3),
        },
      ],
    });
    expect(draft.status).toBe(201);
    const posted = await as(plant).post(`/opening-balances/${draft.body.id}/post`, {
      revision: draft.body.revision,
    });
    expect(posted.status).toBe(200);
    return posted.body.lines[0].lot;
  };

  const line = (lotId: string, overrides: Body = {}): Body => ({
    lotId,
    quantity: '-1.8',
    secondaryQuantity: '-1',
    reason: 'Damaged in the chiller',
    ...overrides,
  });

  const draft = async (
    by: Session,
    locationId: string,
    lines: Body[],
    extra: Body = {},
  ): Promise<Body> => {
    const res = await as(by).post('/stock-adjustments', { locationId, lines, ...extra });
    expect(res.status).toBe(201);
    return res.body;
  };
  const submit = (by: Session, doc: Body) =>
    as(by).post(`/stock-adjustments/${doc.id}/submit`, { revision: doc.revision });
  const submitted = async (by: Session, locationId: string, lines: Body[]): Promise<Body> => {
    const res = await submit(by, await draft(by, locationId, lines));
    expect(res.status).toBe(200);
    return res.body;
  };
  const approve = (by: Session, doc: Body) =>
    as(by).post(`/stock-adjustments/${doc.id}/approve`, { revision: doc.revision });
  const reject = (by: Session, doc: Body, reason: string) =>
    as(by).post(`/stock-adjustments/${doc.id}/reject`, { revision: doc.revision, reason });

  const stock = async (query: Body): Promise<Body> => {
    const res = await as(finance).get('/stock-on-hand').query(query);
    expect(res.status).toBe(200);
    return res.body;
  };
  const metrics = async () =>
    (await request(`http://127.0.0.1:${ctx.metricsPort}`).get('/metrics')).text;
  const metric = async (name: string, labels: Record<string, string>): Promise<number> => {
    const wanted = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    const found = (await metrics())
      .split('\n')
      .find((l) => l.startsWith(`${name}{`) && wanted.every((w) => l.includes(w)));
    return found ? Number(found.split(' ').pop()) : 0;
  };
  const refusals = (rule: string) =>
    metric('erp_postings_total', {
      document_type: 'stock_adjustment',
      outcome: 'refused',
      rule,
    });
  const linesOf = (event: string, documentNumber: string) =>
    ctx
      .logs()
      .filter((l) => l.labels?.event === event && l.labels?.document_number === documentNumber);
  const trail = async (entityId: string) => {
    const res = await as(admin)
      .get('/audit-logs')
      .query({ entityType: 'StockAdjustment', entityId, sortOrder: 'asc' });
    expect(res.status).toBe(200);
    return res.body.data as Body[];
  };

  /** A new account holding the given roles, signed in. */
  const person = async (roles: string[]): Promise<Session> => {
    const email = `${unique('staff').toLowerCase()}@example.test`;
    const res = await as(admin).post('/users', {
      email,
      displayName: 'สมชาย ทดสอบ',
      password: TEST_PASSWORD,
      roles,
    });
    expect(res.status).toBe(201);
    return signIn(ctx.server, email, TEST_PASSWORD);
  };

  describe('the demo seed', () => {
    it('includes one approved write-off at the plant, raised by the plant and approved by finance', async () => {
      const plants = (await as(finance).get('/locations').query({ type: 'plant' })).body as Body[];
      const plantId = plants.find((l) => l.code === DEMO_WRITE_OFF.locationCode)!.id;
      const list = (await as(finance).get('/stock-adjustments').query({ locationId: plantId }))
        .body as Body[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        type: 'stock_adjustment',
        status: 'posted',
        lineCount: 1,
        createdBy: { displayName: 'Demo plant' },
      });

      const doc = (await as(finance).get(`/stock-adjustments/${list[0].id}`)).body;
      expect(doc).toMatchObject({
        approved: { by: { displayName: 'Demo finance' } },
        rejected: null,
        lines: [
          {
            item: { code: 'WHOLE-CHICKEN' },
            quantity: DEMO_WRITE_OFF.quantity,
            secondaryQuantity: DEMO_WRITE_OFF.secondaryQuantity,
            reason: DEMO_WRITE_OFF.reason,
            unitCost: '72.5',
            value: '-130.5',
          },
        ],
      });
      // What the write-off left of the lot is what the demo cutting order (#13) then took: all of it.
      const opening = DEMO_OPENING_BALANCE.lines[DEMO_WRITE_OFF.openingBalanceLineNo - 1];
      expect(opening).toMatchObject({ quantity: '21.600', secondaryQuantity: '12' });
      const cut = (await as(plant).get('/production-orders').query({ status: 'posted' }))
        .body as Body[];
      const demoOrder = cut.find((o) => o.note === DEMO_PRODUCTION_ORDER.note)!;
      const order = (await as(plant).get(`/production-orders/${demoOrder.id}`)).body;
      expect(order.inputs[0].picks[0]).toMatchObject({
        lotId: doc.lines[0].lot.id,
        quantity: '19.8',
        pieces: '11',
      });
      const row = (await stock({ locationId: plantId })).rows.find(
        (r: Body) => r.lot.id === doc.lines[0].lot.id,
      );
      expect(row).toBeUndefined();
    });
  });

  describe('from draft to posted', () => {
    it('is drafted and edited freely, submitted, then approved by someone else, which posts it', async () => {
      const location = await newLocation('plant');
      const lot = await chickenLot(location.id);

      const doc = await draft(plant, location.id, [line(lot.id)], {
        note: 'Chiller door left open',
      });
      expect(doc).toMatchObject({
        type: 'stock_adjustment',
        status: 'draft',
        revision: 1,
        businessDate: today,
        note: 'Chiller door left open',
        location: { id: location.id, code: location.code },
        submitted: null,
        approved: null,
        rejected: null,
        lines: [
          {
            lineNo: 1,
            item: { code: 'WHOLE-CHICKEN', baseUnitCode: 'kg', variableWeight: true },
            lot: { id: lot.id, number: lot.number },
            quantity: '-1.800',
            secondaryQuantity: '-1',
            unitCost: '72.5',
            value: '-130.5',
            reason: 'Damaged in the chiller',
          },
        ],
        totalValue: '-130.5',
      });
      expect(doc.number).toMatch(DOCUMENT_NUMBER);
      expect((await stock({ locationId: location.id })).rows[0].quantity).toBe('21.600');

      const edited = await as(plant).patch(`/stock-adjustments/${doc.id}`, {
        revision: doc.revision,
        lines: [line(lot.id, { quantity: '-3.6', secondaryQuantity: '-2' })],
      });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ revision: 2, totalValue: '-261' });

      const sent = await submit(plant, edited.body);
      expect(sent.status).toBe(200);
      expect(sent.body).toMatchObject({
        status: 'submitted',
        revision: 3,
        submitted: { by: { id: plant.user.id } },
      });
      expect((await stock({ locationId: location.id })).rows[0].quantity).toBe('21.600');

      const late = await as(plant).patch(`/stock-adjustments/${doc.id}`, {
        revision: sent.body.revision,
        note: 'too late',
      });
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('DOCUMENT_NOT_DRAFT');

      const before = await metric('erp_postings_total', {
        document_type: 'stock_adjustment',
        outcome: 'succeeded',
      });
      const approved = await approve(finance, sent.body);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({
        status: 'posted',
        approved: { by: { id: finance.user.id } },
        postedBy: { id: finance.user.id },
        postingRefusal: null,
      });
      expect(
        await metric('erp_postings_total', {
          document_type: 'stock_adjustment',
          outcome: 'succeeded',
        }),
      ).toBe(before + 1);

      expect((await stock({ locationId: location.id })).rows).toMatchObject([
        {
          lot: { id: lot.id },
          quantity: '18.000',
          secondaryQuantity: '10',
          value: '1305',
          countRecommended: false,
        },
      ]);
      const entries = await prisma.$queryRaw<Body[]>`
        SELECT "quantity"::text AS "quantity", "secondary_quantity"::text AS "secondaryQuantity",
               "unit_cost"::text AS "unitCost"
        FROM "ledger_entries" WHERE "document_id" = ${doc.id}::uuid
      `;
      expect(entries).toEqual([
        { quantity: '-3.600', secondaryQuantity: '-2', unitCost: '72.500000' },
      ]);

      expect(await trail(doc.id)).toMatchObject([
        {
          action: 'APPROVE',
          actor: { id: finance.user.id },
          summary: `Approved stock adjustment ${doc.number}`,
          changes: { status: { from: 'submitted', to: 'approved' } },
        },
      ]);
      expect(linesOf('document.approved', doc.number)).toMatchObject([
        { severity: 'INFO', labels: { location_code: location.code } },
      ]);
      expect(linesOf('ledger.posting.succeeded', doc.number)).toHaveLength(1);

      const again = await approve(finance, approved.body);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: 'STEP_NOT_ALLOWED' });
    });

    it('is refused at an older revision, so nobody approves what they have not seen', async () => {
      const location = await newLocation('plant');
      const lot = await chickenLot(location.id);
      const doc = await submitted(plant, location.id, [line(lot.id)]);
      const res = await approve(finance, { ...doc, revision: doc.revision - 1 });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'DOCUMENT_CHANGED',
        details: { currentRevision: doc.revision },
      });
    });

    it('is rejected with a reason, finally, and audited', async () => {
      const location = await newLocation('branch');
      const lot = await chickenLot(location.id);
      const doc = await submitted(branchManager, location.id, [line(lot.id)]);

      const noReason = await reject(finance, doc, '   ');
      expect(noReason.status).toBe(422);
      expect(noReason.body.code).toBe('REJECTION_REASON_MISSING');

      const res = await reject(finance, doc, 'Count it first, then adjust');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'rejected',
        approved: null,
        rejected: { by: { id: finance.user.id }, reason: 'Count it first, then adjust' },
      });
      expect(await trail(doc.id)).toMatchObject([
        {
          action: 'REJECT',
          actor: { id: finance.user.id },
          changes: {
            status: { from: 'submitted', to: 'rejected' },
            reason: 'Count it first, then adjust',
          },
        },
      ]);
      expect(linesOf('document.rejected', doc.number)).toMatchObject([
        { severity: 'INFO', labels: { location_code: location.code } },
      ]);
      expect((await approve(finance, res.body)).status).toBe(409);
      expect((await submit(branchManager, res.body)).status).toBe(409);
      expect((await stock({ locationId: location.id })).rows[0].quantity).toBe('21.600');
    });
  });

  describe('segregation of duties (ADR-0008)', () => {
    it('refuses the creator even when they hold both roles, and lets someone else approve', async () => {
      const both = await person(['plant', 'finance']);
      expect(both.user.permissions).toEqual(
        expect.arrayContaining(['stock_adjustment:raise', 'stock_adjustment:approve']),
      );
      const location = await newLocation('plant');
      const lot = await chickenLot(location.id);
      const doc = await submitted(both, location.id, [line(lot.id)]);

      const before = await refusals('self_approval');
      const self = await approve(both, doc);
      expect(self.status).toBe(422);
      expect(self.body).toMatchObject({
        code: 'POSTING_REFUSED',
        details: { rule: 'self_approval' },
      });
      expect(await refusals('self_approval')).toBe(before + 1);
      expect(linesOf('ledger.posting.refused', doc.number)).toMatchObject([
        { severity: 'WARNING', labels: { rule: 'self_approval', location_code: location.code } },
      ]);
      const unchanged = (await as(finance).get(`/stock-adjustments/${doc.id}`)).body;
      expect(unchanged).toMatchObject({
        status: 'submitted',
        revision: doc.revision,
        approved: null,
      });
      expect(await trail(doc.id)).toEqual([]);

      const byOther = await approve(finance, doc);
      expect(byOther.status).toBe(200);
      expect(byOther.body).toMatchObject({
        status: 'posted',
        approved: { by: { id: finance.user.id } },
      });
    });

    it('is kept by the database too, for anything that goes around the service', async () => {
      const location = await newLocation('plant');
      const lot = await chickenLot(location.id);
      const doc = await submitted(plant, location.id, [line(lot.id)]);
      await expect(prisma.$executeRaw`
        UPDATE "stock_adjustments" SET "approved_by_id" = ${plant.user.id}::uuid, "approved_at" = now()
        WHERE "document_id" = ${doc.id}::uuid
      `).rejects.toThrow(/nobody approves a document they created/);
      await expect(prisma.$executeRaw`
        UPDATE "stock_adjustment_lines" SET "quantity" = -20 WHERE "document_id" = ${doc.id}::uuid
      `).rejects.toThrow(/fixed once the document leaves draft/);
      await expect(prisma.$executeRaw`
        DELETE FROM "stock_adjustments" WHERE "document_id" = ${doc.id}::uuid
      `).rejects.toThrow(/never deleted/);
    });

    it('lets plant and branch managers raise, finance approve, and anyone signed in read', async () => {
      const location = await newLocation('plant');
      const lot = await chickenLot(location.id);
      const body = { locationId: location.id, lines: [line(lot.id)] };
      expect((await as(finance).post('/stock-adjustments', body)).status).toBe(403);
      expect((await as(admin).post('/stock-adjustments', body)).status).toBe(403);
      expect((await as(null).post('/stock-adjustments', body)).status).toBe(401);

      const doc = await submitted(plant, location.id, [line(lot.id)]);
      expect((await approve(plant, doc)).status).toBe(403);
      expect((await approve(branchManager, doc)).status).toBe(403);
      expect((await reject(plant, doc, 'no')).status).toBe(403);
      expect((await as(branchManager).get(`/stock-adjustments/${doc.id}`)).status).toBe(200);
      expect((await as(null).get(`/stock-adjustments/${doc.id}`)).status).toBe(401);
    });
  });

  describe('the negative-stock rule (ADR-0003)', () => {
    it('posts exactly one of two adjustments approved at the same moment against the same plant lot', async () => {
      const location = await newLocation('plant');
      const lot = await chickenLot(location.id);
      const first = await submitted(plant, location.id, [
        line(lot.id, { quantity: '-15', secondaryQuantity: null }),
      ]);
      const second = await submitted(plant, location.id, [
        line(lot.id, { quantity: '-15', secondaryQuantity: null }),
      ]);

      const before = await refusals('negative_stock_plant');
      const results = await Promise.all([approve(finance, first), approve(finance, second)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const outcomes = results.map((r) => r.body.status).sort();
      expect(outcomes).toEqual(['approved', 'posted']);
      const refused = results.find((r) => r.body.status === 'approved')!.body;
      expect(refused.postingRefusal).toMatchObject({
        rule: 'negative_stock_plant',
        details: {
          lotId: lot.id,
          lotNumber: lot.number,
          locationCode: location.code,
          quantity: '-8.4',
        },
      });
      expect(await refusals('negative_stock_plant')).toBe(before + 1);

      const rows = (await stock({ locationId: location.id })).rows;
      expect(rows).toMatchObject([{ lot: { id: lot.id }, quantity: '6.600' }]);
      const balance = await prisma.stockBalance.findFirstOrThrow({
        where: { lotId: lot.id, locationId: location.id },
      });
      expect(balance.quantity.toFixed()).toBe('6.6');

      // Still refused when tried again; then turned down, keeping who approved it.
      const retry = await as(finance).post(`/stock-adjustments/${refused.id}/post`, {
        revision: refused.revision,
      });
      expect(retry.status).toBe(422);
      expect(retry.body.details).toMatchObject({
        rule: 'negative_stock_plant',
        lotNumber: lot.number,
      });
      const turnedDown = await reject(finance, refused, 'The stock was already written off');
      expect(turnedDown.status).toBe(200);
      expect(turnedDown.body).toMatchObject({
        status: 'rejected',
        approved: { by: { id: finance.user.id } },
        rejected: { reason: 'The stock was already written off' },
      });
    });

    it('lets a branch lot go below zero, flagged for a count in stock on hand, the log and the gauge', async () => {
      const branch = await newLocation('branch');
      const lot = await chickenLot(branch.id);
      expect(await metric('erp_negative_branch_balances', { location_code: branch.code })).toBe(0);

      const doc = await submitted(branchManager, branch.id, [
        line(lot.id, { quantity: '-25', secondaryQuantity: '-12', reason: 'Counted: none left' }),
      ]);
      const res = await approve(finance, doc);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'posted', postingRefusal: null });

      const view = await stock({ locationId: branch.id });
      expect(view.rows).toMatchObject([
        { lot: { id: lot.id }, quantity: '-3.400', countRecommended: true },
      ]);
      expect(view.negativeBranchBalances).toBe(1);
      expect(await metric('erp_negative_branch_balances', { location_code: branch.code })).toBe(1);
      expect(
        ctx
          .logs()
          .filter(
            (l) =>
              l.labels?.event === 'app.log' &&
              l.labels?.document_number === doc.number &&
              l.labels?.location_code === branch.code,
          ),
      ).toMatchObject([
        { severity: 'WARNING', message: expect.stringContaining('count recommended') },
      ]);
    });
  });

  describe('lines', () => {
    it('writes an expired lot off, but never increases one (ADR-0006)', async () => {
      const location = await newLocation('plant');
      const lot = await chickenLot(location.id, {
        businessDate: addDays(today, -3),
        expiryDate: addDays(today, -1),
      });

      const increase = await submit(
        plant,
        await draft(plant, location.id, [
          line(lot.id, { quantity: '1.8', secondaryQuantity: '1' }),
        ]),
      );
      expect(increase.status).toBe(422);
      expect(increase.body).toMatchObject({
        code: 'POSTING_REFUSED',
        details: { rule: 'expired_lot', lineNo: 1 },
      });

      const writeOff = await submitted(plant, location.id, [
        line(lot.id, { quantity: '-21.6', secondaryQuantity: '-12', reason: 'Expired' }),
      ]);
      const res = await approve(finance, writeOff);
      expect(res.body).toMatchObject({ status: 'posted', postingRefusal: null });
      expect((await stock({ locationId: location.id })).rows).toEqual([]);
    });

    it('refuses what cannot be an adjustment, saying which line and why', async () => {
      const location = await newLocation('plant');
      const elsewhere = await newLocation('plant');
      const lot = await chickenLot(location.id);
      const otherLot = await chickenLot(elsewhere.id);
      const inTransit = (await as(finance).get('/locations').query({ type: 'in_transit' }))
        .body as Body[];

      const cases: Array<[Body, string, Body]> = [
        [{ lines: [line(otherLot.id)] }, 'LOT_NOT_AT_LOCATION', { lineNo: 1 }],
        [{ lines: [line(lot.id), line(lot.id)] }, 'DUPLICATE_LOT', { lineNo: 2 }],
        [
          { lines: [line(lot.id, { quantity: '0' })] },
          'INVALID_STOCK_ADJUSTMENT_LINE',
          { problem: 'QUANTITY_ZERO' },
        ],
        [
          { lines: [line(lot.id, { secondaryQuantity: '1' })] },
          'INVALID_STOCK_ADJUSTMENT_LINE',
          { problem: 'SECONDARY_QUANTITY_SIGN' },
        ],
        [
          { lines: [line(lot.id, { reason: '  ' })] },
          'INVALID_STOCK_ADJUSTMENT_LINE',
          { problem: 'REASON_MISSING' },
        ],
        [
          { lines: [line(lot.id, { quantity: '-1.0001' })] },
          'INVALID_STOCK_ADJUSTMENT_LINE',
          { problem: 'QUANTITY_TOO_PRECISE' },
        ],
        [
          { locationId: inTransit[0].id, lines: [] },
          'LOCATION_NOT_ALLOWED',
          { problem: 'LOCATION_SYSTEM_MANAGED' },
        ],
      ];
      for (const [body, code, details] of cases) {
        const res = await as(plant).post('/stock-adjustments', {
          locationId: location.id,
          ...body,
        });
        expect({
          status: res.status,
          code: res.body.code,
          details: res.body.details,
        }).toMatchObject({ status: 422, code, details });
      }

      const empty = await draft(plant, location.id, []);
      const res = await submit(plant, empty);
      expect(res.status).toBe(422);
      expect(res.body.details).toMatchObject({ rule: 'empty_document' });

      const moved = await as(plant).patch(`/stock-adjustments/${empty.id}`, {
        revision: empty.revision,
        lines: [line(lot.id)],
      });
      expect(moved.status).toBe(200);
      const toElsewhere = await as(plant).patch(`/stock-adjustments/${empty.id}`, {
        revision: moved.body.revision,
        locationId: elsewhere.id,
      });
      expect(toElsewhere.status).toBe(422);
      expect(toElsewhere.body.code).toBe('LOT_NOT_AT_LOCATION');
    });
  });
});

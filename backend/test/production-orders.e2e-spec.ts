// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Production orders (#13), end to end against a real PostgreSQL: the demo cutting order, the
 * whole flow from draft to posted, FEFO picks and overrides that never take an expired lot,
 * refusals by rule (expired lot, negative plant stock, missing or zero actuals), a production
 * order and an adjustment racing for one lot, exact cost allocation as stored, genealogy, reversal,
 * who may do what, and the logs and metrics.
 */
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { addDays } from 'src/core/time/domain/business-date';
import { DEMO_PRODUCTION_ORDER } from '../prisma/demo-data';
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

describe('production orders (#13)', () => {
  let ctx: TestContext;
  let admin: Session;
  let plant: Session;
  let finance: Session;
  let branchManager: Session;
  let prisma: PrismaService;
  let today: string;
  let items: Map<string, Body>;
  let cutting: Body;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    admin = await signInAsAdmin(ctx.server);
    plant = await signIn(ctx.server, demoEmail('plant'));
    finance = await signIn(ctx.server, demoEmail('finance'));
    branchManager = await signIn(ctx.server, demoEmail('branch_manager'));
    today = (await as(finance).get('/stock-on-hand')).body.asOf;
    const all = await as(finance).get('/items').query({ status: 'all' });
    items = new Map(all.body.map((i: Body) => [i.code, i]));
    const boms = (await as(plant).get('/production-boms')).body as Body[];
    cutting = boms.find((b) => b.code === DEMO_PRODUCTION_ORDER.bomCode)!;
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

  const newPlant = async (): Promise<Body> => {
    const res = await as(admin).post('/locations', {
      code: unique('PL'),
      type: 'plant',
      nameTh: 'โรงงานทดสอบ',
      nameEn: 'Test plant',
    });
    expect(res.status).toBe(201);
    return res.body;
  };

  /** Whole-chicken lots brought into a plant by one opening balance dated yesterday. */
  const chickenLots = async (
    locationId: string,
    lots: ReadonlyArray<{ quantity: string; pieces: string; unitCost: string; expiresIn: number }>,
  ): Promise<Body[]> => {
    const draft = await as(plant).post('/opening-balances', {
      locationId,
      businessDate: addDays(today, -1),
      lines: lots.map((lot) => ({
        itemId: items.get('WHOLE-CHICKEN')!.id,
        quantity: lot.quantity,
        secondaryQuantity: lot.pieces,
        unitCost: lot.unitCost,
        expiryDate: addDays(today, lot.expiresIn),
      })),
    });
    expect(draft.status).toBe(201);
    const posted = await as(plant).post(`/opening-balances/${draft.body.id}/post`, {
      revision: draft.body.revision,
    });
    expect(posted.status).toBe(200);
    return posted.body.lines.map((l: Body) => l.lot);
  };

  /** Two lots: 21.6 kg at 72.5 expiring in two days, 21.6 kg at 71 expiring in three. */
  const twoLots = (locationId: string) =>
    chickenLots(locationId, [
      { quantity: '21.6', pieces: '12', unitCost: '71', expiresIn: 3 },
      { quantity: '21.6', pieces: '12', unitCost: '72.5', expiresIn: 2 },
    ]);

  const draftOrder = async (locationId: string, plannedQuantity = '30'): Promise<Body> => {
    const res = await as(plant).post('/production-orders', {
      bomId: cutting.id,
      locationId,
      plannedQuantity,
    });
    expect(res.status).toBe(201);
    return res.body;
  };

  const release = async (order: Body): Promise<Body> => {
    const res = await as(plant).post(`/production-orders/${order.id}/release`, {
      revision: order.revision,
    });
    expect(res.status).toBe(200);
    return res.body;
  };

  /** What came out of 30 kg: 26.2 kg of pieces and frames, 87.33 % against 90 %. */
  const OUTPUTS = [
    { lineNo: 1, quantity: '32', weightKg: '7.2' },
    { lineNo: 2, quantity: '33', weightKg: '5.3' },
    { lineNo: 3, quantity: '33', weightKg: '4.1' },
    { lineNo: 4, quantity: '33', weightKg: '3.2' },
    { lineNo: 5, quantity: '6.4', pieces: '16' },
  ];

  const record = (order: Body, body: Body) =>
    as(plant).put(`/production-orders/${order.id}/actuals`, { revision: order.revision, ...body });

  const recorded = async (order: Body, body: Body = { outputs: OUTPUTS }): Promise<Body> => {
    const res = await record(order, body);
    expect(res.status).toBe(200);
    return res.body;
  };

  const post = (order: Body) =>
    as(plant).post(`/production-orders/${order.id}/post`, { revision: order.revision });

  /** A released, fully recorded order at a new plant with two chicken lots, ready to post. */
  const readyOrder = async () => {
    const location = await newPlant();
    const lots = await twoLots(location.id);
    const order = await recorded(await release(await draftOrder(location.id)));
    return { location, lots, order };
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
  const postings = (outcome: string, rule = '') =>
    metric('erp_postings_total', { document_type: 'production_order', outcome, rule });

  /**
   * ADR-0027, read straight from the database: Σ output lot values + Σ rounding differences =
   * Σ consumed input value, compared by PostgreSQL in NUMERIC, so a truncated column would show.
   */
  const costBalance = async (documentId: string) => {
    const [row] = await prisma.$queryRaw<
      Array<{ consumed: string; lots: string; differences: string; balanced: boolean }>
    >`
      WITH consumed AS (
        SELECT -SUM(e."quantity" * e."unit_cost") AS v FROM "ledger_entries" e
        WHERE e."document_id" = ${documentId}::uuid AND e."quantity" < 0
      ), made AS (
        SELECT SUM(l."quantity" * l."unit_cost") AS v FROM "lots" l
        WHERE l."origin_document_id" = ${documentId}::uuid
      ), differences AS (
        SELECT SUM(o."rounding_difference") AS v FROM "production_order_outputs" o
        WHERE o."document_id" = ${documentId}::uuid
      )
      SELECT consumed.v::text AS "consumed", made.v::text AS "lots", differences.v::text AS "differences",
             made.v + differences.v = consumed.v AS "balanced"
      FROM consumed, made, differences
    `;
    return row;
  };

  describe('the demo seed', () => {
    it('posts one whole-chicken cutting order, picked FEFO, with a yield a little below the BOM', async () => {
      const list = (await as(finance).get('/production-orders')).body as Body[];
      const demo = list.find((o) => o.note === DEMO_PRODUCTION_ORDER.note)!;
      expect(demo).toMatchObject({
        type: 'production_order',
        status: 'posted',
        bom: { code: 'CUT-WHOLE-CHICKEN', version: { number: 1 } },
        location: { code: 'PLANT-01' },
        plannedQuantity: '200.000',
        yield: { expected: '90.00', actual: '88.00', difference: '-2.00' },
      });
      const order = (await as(finance).get(`/production-orders/${demo.id}`)).body;
      // Three opening-balance lots first, earliest expiry first, then the warm-truck delivery.
      expect(order.inputs[0].picks.map((p: Body) => p.quantity)).toEqual([
        '19.8',
        '43.2',
        '18',
        '119',
      ]);
      expect(order.inputs[0].picks[3].number).toMatch(/^GR-/);
      // The oldest chicken it used expires tomorrow, and so does everything it made.
      for (const output of order.outputs) {
        expect(output.expiry.expiryDate).toBe(addDays(today, 1));
        expect(output.lot.number).toMatch(/^MO-\d{4}-\d{5}\/\d+$/);
      }
      expect(order.genealogy).toHaveLength(order.outputs.length * order.inputs[0].picks.length);
      expect((await costBalance(demo.id)).balanced).toBe(true);
    });
  });

  describe('the whole flow', () => {
    it('plans from the BOM, picks FEFO on release, shows yield and cost, and posts lots with genealogy', async () => {
      const location = await newPlant();
      const lots = await twoLots(location.id);
      const draft = await draftOrder(location.id);
      expect(draft).toMatchObject({
        status: 'draft',
        number: expect.stringMatching(/^MO-\d{4}-\d{5}$/),
        bom: { id: cutting.id, version: { number: 1 } },
        plannedQuantity: '30.000',
      });
      expect(draft.inputs[0]).toMatchObject({ plannedQuantity: '30.000', shortBy: '0' });
      // 22 pieces per 20 kg, scaled to 30 kg: 33; frames 4.4 kg scaled: 6.6.
      expect(draft.outputs.map((o: Body) => o.plannedQuantity)).toEqual([
        '33',
        '33',
        '33',
        '33',
        '6.600',
      ]);
      // A draft shows what FEFO would take: the lot expiring in two days first.
      expect(draft.inputs[0].picks.map((p: Body) => [p.lotId, p.quantity])).toEqual([
        [lots[1].id, '21.6'],
        [lots[0].id, '8.4'],
      ]);
      expect(draft.blockers.map((b: Body) => b.rule)).toContain('actuals_missing');

      const released = await release(draft);
      expect(released).toMatchObject({
        status: 'released',
        released: { by: { displayName: 'Demo plant' } },
      });
      expect(released.inputs[0].picksOverridden).toBe(false);

      const order = await recorded(released);
      expect(order.blockers).toEqual([]);
      expect(order.inputValue).toBe('2162.4');
      expect(order.yield).toEqual({ expected: '90.00', actual: '87.33', difference: '-2.67' });
      // Breast: 35 % of 2,162.4 = 756.84 over 32 pieces.
      expect(order.outputs[0].cost).toEqual({
        allocatedValue: '756.84',
        unitCost: '23.651250',
        lotValue: '756.84',
        roundingDifference: '0',
      });
      expect(order.outputs[0].expiry).toEqual({
        expiryDate: addDays(today, 2),
        computedExpiryDate: addDays(today, 4),
        earliestInputExpiryDate: addDays(today, 2),
      });

      const before = await postings('succeeded');
      const res = await post(order);
      expect(res.status).toBe(200);
      const posted = res.body;
      expect(posted.status).toBe('posted');
      expect(posted.yield.actual).toBe('87.33');
      expect(posted.outputs[4]).toMatchObject({
        actualQuantity: '6.400',
        actualPieces: '16',
        lot: { number: `${posted.number}/6` },
        cost: { unitCost: '27.030000', roundingDifference: '0' },
      });
      expect(await postings('succeeded')).toBe(before + 1);

      // Inputs came out of the plant, outputs went in.
      const stock = (await as(finance).get('/stock-on-hand').query({ locationId: location.id }))
        .body;
      const byLot = new Map(stock.rows.map((r: Body) => [r.lot.id, r]));
      expect(byLot.has(lots[1].id)).toBe(false);
      expect(byLot.get(lots[0].id)).toMatchObject({ quantity: '13.200' });
      const breast = posted.outputs[0].lot.id;
      expect(byLot.get(breast)).toMatchObject({ quantity: '32', unitCost: '23.65125' });

      // Genealogy: every output lot to both input lots, with what the order consumed of each.
      expect(posted.genealogy).toHaveLength(10);
      const links = (await as(finance).get(`/production-orders/genealogy/${breast}`)).body;
      expect(links.map((l: Body) => [l.inputLot.id, l.inputQuantity])).toEqual(
        expect.arrayContaining([
          [lots[1].id, '21.6'],
          [lots[0].id, '8.4'],
        ]),
      );
      expect((await costBalance(order.id)).balanced).toBe(true);

      // Logged with the order's number.
      expect(
        ctx
          .logs()
          .some(
            (l) =>
              l.labels?.event === 'ledger.posting.succeeded' &&
              l.labels?.document_number === posted.number,
          ),
      ).toBe(true);
      expect(
        await metric('erp_production_yield_percent', {
          bom_code: 'CUT-WHOLE-CHICKEN',
          measure: 'expected',
        }),
      ).toBe(90);
    });

    it('stores every digit of the allocation and balances to the last one when the cost does not divide', async () => {
      const location = await newPlant();
      // 21.6 kg at 70.123457: a value with nine decimals, split 35/22/18/17/8 over odd counts.
      await chickenLots(location.id, [
        { quantity: '21.6', pieces: '12', unitCost: '70.123457', expiresIn: 3 },
      ]);
      const order = await recorded(await release(await draftOrder(location.id, '21.6')), {
        outputs: [
          { lineNo: 1, quantity: '23', weightKg: '5.3' },
          { lineNo: 2, quantity: '22', weightKg: '3.7' },
          { lineNo: 3, quantity: '21', weightKg: '2.9' },
          { lineNo: 4, quantity: '23', weightKg: '2.4' },
          { lineNo: 5, quantity: '4.7', pieces: '12' },
        ],
      });
      const res = await post(order);
      expect(res.status).toBe(200);
      const stored = await prisma.$queryRaw<Array<{ allocated: string; difference: string }>>`
        SELECT "allocated_value"::text AS "allocated", "rounding_difference"::text AS "difference"
        FROM "production_order_outputs" WHERE "document_id" = ${order.id}::uuid ORDER BY "line_no"
      `;
      // 21.6 × 70.123457 = 1,514.6666712; × 35 % = 530.13333492, kept whole.
      expect(stored[0].allocated).toBe('530.13333492');
      expect(res.body.outputs[0].cost.allocatedValue).toBe('530.13333492');
      expect(stored.some((s) => s.difference !== '0')).toBe(true);
      const balance = await costBalance(order.id);
      expect(balance.balanced).toBe(true);
      expect(balance.consumed).toBe('1514.666671200');
    });
  });

  describe('picking', () => {
    it('never picks or takes an expired lot, and marks a changed pick as overridden', async () => {
      const location = await newPlant();
      const [expired, fresh] = await chickenLots(location.id, [
        { quantity: '10', pieces: '6', unitCost: '70', expiresIn: -1 },
        { quantity: '30', pieces: '17', unitCost: '72', expiresIn: 3 },
      ]);
      const released = await release(await draftOrder(location.id, '20'));
      expect(released.inputs[0].picks.map((p: Body) => p.lotId)).toEqual([fresh.id]);
      const shown = released.inputs[0].availableLots.find((l: Body) => l.lotId === expired.id);
      expect(shown).toMatchObject({ expired: true });

      const refused = await record(released, {
        inputs: [{ lineNo: 1, picks: [{ lotId: expired.id, quantity: '10' }] }],
      });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('EXPIRED_LOT');

      const changed = await recorded(released, {
        inputs: [{ lineNo: 1, picks: [{ lotId: fresh.id, quantity: '18', pieces: '10' }] }],
      });
      expect(changed.inputs[0]).toMatchObject({
        picksOverridden: true,
        quantity: '18',
        shortBy: '2',
      });
    });

    it('refuses a lot of another item, or one the plant does not hold', async () => {
      const location = await newPlant();
      const other = await newPlant();
      const [elsewhere] = await twoLots(other.id);
      await twoLots(location.id);
      const released = await release(await draftOrder(location.id));
      const res = await record(released, {
        inputs: [{ lineNo: 1, picks: [{ lotId: elsewhere.id, quantity: '1' }] }],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_PRODUCTION_LINE');
    });
  });

  describe('refusals', () => {
    it('refuses an expired input lot at posting, counted by rule, and writes nothing', async () => {
      const { location, order } = await readyOrder();
      // A lot that expired before the order's date, put on the order behind the API's back.
      const [old] = await chickenLots(location.id, [
        { quantity: '5', pieces: '3', unitCost: '70', expiresIn: -1 },
      ]);
      await prisma.$executeRaw`
        UPDATE "production_order_picks" SET "lot_id" = ${old.id}::uuid, "quantity" = 5
        WHERE "document_id" = ${order.id}::uuid AND "quantity" = 8.4
      `;
      const before = await postings('refused', 'expired_lot');
      const res = await post(order);
      expect(res.status).toBe(422);
      expect(res.body.details.rule).toBe('expired_lot');
      expect(await postings('refused', 'expired_lot')).toBe(before + 1);
      expect(await prisma.lot.count({ where: { originDocumentId: order.id } })).toBe(0);
    });

    it('refuses a plant lot going below zero, and leaves the order released', async () => {
      const location = await newPlant();
      const [lot] = await chickenLots(location.id, [
        { quantity: '10', pieces: '6', unitCost: '70', expiresIn: 3 },
      ]);
      const released = await release(await draftOrder(location.id, '10'));
      const order = await recorded(released, {
        inputs: [{ lineNo: 1, picks: [{ lotId: lot.id, quantity: '12' }] }],
        outputs: OUTPUTS,
      });
      const before = await postings('refused', 'negative_stock_plant');
      const res = await post(order);
      expect(res.status).toBe(422);
      expect(res.body.details).toMatchObject({
        rule: 'negative_stock_plant',
        lotNumber: lot.number,
      });
      expect(await postings('refused', 'negative_stock_plant')).toBe(before + 1);
      const after = (await as(plant).get(`/production-orders/${order.id}`)).body;
      expect(after.status).toBe('released');
      expect(await prisma.lotGenealogy.count({ where: { documentId: order.id } })).toBe(0);
    });

    it('refuses missing actuals and a zero output with their own reasons', async () => {
      const location = await newPlant();
      await twoLots(location.id);
      const released = await release(await draftOrder(location.id));
      let res = await post(released);
      expect(res.status).toBe(422);
      expect(res.body.details.rule).toBe('actuals_missing');

      const zero = await recorded(released, {
        outputs: OUTPUTS.map((o) => (o.lineNo === 4 ? { ...o, quantity: '0', weightKg: '0' } : o)),
      });
      expect(zero.blockers).toEqual([{ rule: 'zero_output_quantity', side: 'output', lineNo: 4 }]);
      res = await post(zero);
      expect(res.status).toBe(422);
      expect(res.body.details.rule).toBe('zero_output_quantity');
      expect(res.body.message).toMatch(/cannot carry a cost/);
    });

    it('needs a measured weight for pieces and a piece count for a variable-weight output', async () => {
      const location = await newPlant();
      await twoLots(location.id);
      const released = await release(await draftOrder(location.id));
      const order = await recorded(released, {
        outputs: OUTPUTS.map((o) =>
          o.lineNo === 1
            ? { lineNo: 1, quantity: '32' }
            : o.lineNo === 5
              ? { lineNo: 5, quantity: '6.4' }
              : o,
        ),
      });
      expect(order.blockers).toEqual([
        { rule: 'weight_required', side: 'output', lineNo: 1 },
        { rule: 'pieces_required', side: 'output', lineNo: 5 },
      ]);
      expect(order.yield.actual).toBeNull();
    });
  });

  it('lets exactly one of a production order and an adjustment take the same lot past its balance', async () => {
    const location = await newPlant();
    const [lot] = await chickenLots(location.id, [
      { quantity: '21.6', pieces: '12', unitCost: '72.5', expiresIn: 3 },
    ]);
    const order = await recorded(await release(await draftOrder(location.id, '20')), {
      outputs: OUTPUTS,
    });
    const adjustment = await as(plant).post('/stock-adjustments', {
      locationId: location.id,
      lines: [{ lotId: lot.id, quantity: '-5', reason: 'Damaged in the chiller' }],
    });
    expect(adjustment.status).toBe(201);
    const submitted = await as(plant).post(`/stock-adjustments/${adjustment.body.id}/submit`, {
      revision: adjustment.body.revision,
    });
    expect(submitted.status).toBe(200);

    const [production, approval] = await Promise.all([
      post(order),
      as(finance).post(`/stock-adjustments/${adjustment.body.id}/approve`, {
        revision: submitted.body.revision,
      }),
    ]);
    const outcomes = [production.status, approval.status].sort();
    expect(outcomes).toEqual([200, 422]);
    const loser = production.status === 422 ? production : approval;
    expect(loser.body.details.rule).toBe('negative_stock_plant');
    const balance = await prisma.stockBalance.findUniqueOrThrow({
      where: { lotId_locationId: { lotId: lot.id, locationId: location.id } },
    });
    expect(Number(balance.quantity)).toBeGreaterThanOrEqual(0);
    expect(balance.quantity.toFixed()).toBe(production.status === 200 ? '1.6' : '16.6');
  });

  describe('reversal', () => {
    it('takes the outputs back out and the inputs back in, and drops the genealogy from traces only', async () => {
      const { location, lots, order } = await readyOrder();
      const posted = (await post(order)).body;
      const breast = posted.outputs[0].lot.id;

      const res = await as(plant).post(`/production-orders/${order.id}/reverse`, {
        note: 'Wrong BOM',
      });
      expect(res.status).toBe(201);
      expect(res.body.reversal.number).toMatch(/^RV-/);
      expect(res.body.order.reversedBy).toMatchObject({ number: res.body.reversal.number });

      const stock = (await as(finance).get('/stock-on-hand').query({ locationId: location.id }))
        .body;
      const byLot = new Map(stock.rows.map((r: Body) => [r.lot.id, r]));
      expect(byLot.get(lots[1].id)).toMatchObject({ quantity: '21.600' });
      expect(byLot.has(breast)).toBe(false);

      const trace = (await as(finance).get(`/production-orders/genealogy/${breast}`)).body;
      expect(trace).toEqual([]);
      const history = (
        await as(finance)
          .get(`/production-orders/genealogy/${breast}`)
          .query({ includeReversed: 'true' })
      ).body;
      expect(history).toHaveLength(2);
      expect(history.every((l: Body) => l.reversed)).toBe(true);

      const again = await as(plant).post(`/production-orders/${order.id}/reverse`, {});
      expect(again.status).toBe(409);
      expect(again.body.details.rule).toBe('already_reversed');
    });
  });

  describe('steps and access', () => {
    it('cancels a draft or released order with a reason, and nothing changes it afterwards', async () => {
      const location = await newPlant();
      await twoLots(location.id);
      const released = await release(await draftOrder(location.id));
      const res = await as(plant).post(`/production-orders/${released.id}/cancel`, {
        revision: released.revision,
        reason: 'Line stopped',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        cancelled: { reason: 'Line stopped' },
      });
      const after = await record(res.body, { outputs: OUTPUTS });
      expect(after.status).toBe(409);
      const posting = await post(res.body);
      expect(posting.status).toBe(409);
      expect(posting.body.details.rule).toBe('not_released');
    });

    it('refuses a planned quantity the item cannot hold, and a BOM at a branch', async () => {
      const location = await newPlant();
      const res = await as(plant).post('/production-orders', {
        bomId: cutting.id,
        locationId: location.id,
        plannedQuantity: '1.2345',
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_PLANNED_QUANTITY');
      const branch = (await as(finance).get('/locations').query({ type: 'branch' })).body[0];
      const wrong = await as(plant).post('/production-orders', {
        bomId: cutting.id,
        locationId: branch.id,
        plannedQuantity: '20',
      });
      expect(wrong.status).toBe(422);
      expect(wrong.body.code).toBe('WRONG_LOCATION_TYPE');
    });

    it('lets finance read but not run production, and a branch manager neither', async () => {
      const location = await newPlant();
      expect((await as(finance).get('/production-orders')).status).toBe(200);
      const run = await as(finance).post('/production-orders', {
        bomId: cutting.id,
        locationId: location.id,
        plannedQuantity: '20',
      });
      expect(run.status).toBe(403);
      expect((await as(branchManager).get('/production-orders')).status).toBe(403);
      expect((await as(null).get('/production-orders')).status).toBe(401);
    });
  });
});

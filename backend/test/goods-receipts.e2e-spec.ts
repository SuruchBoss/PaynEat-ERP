// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Goods receipts and returns to supplier (#11), end to end against a real PostgreSQL. The plant
 * receives against an approved or sent purchase order; each line is inspected with the one
 * inspection model (ADR-0007): over or under quantity, too warm, damaged, short dated (ADR-0014).
 * A receipt with no finding posts on submission; one with a finding needs a reason and a purchasing
 * approver who did not create it (ADR-0008). Posting creates one lot per accepted line at the order
 * line's cost (ADR-0004) with the earlier expiry and both dates kept (ADR-0014), records what
 * arrived on the order, and turns rejected quantity into a return to supplier with no ledger
 * entries. Two receipts posted at once can never together exceed an order line.
 */
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { addDays, dateIn } from 'src/core/time/domain/business-date';
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

const RECEIPT_NUMBER = /^GR-\d{4}-\d{5}$/;
const RETURN_NUMBER = /^RTS-\d{4}-\d{5}$/;

describe('goods receipts', () => {
  let ctx: TestContext;
  let admin: Session;
  let purchasing: Session;
  let approver: Session;
  let finance: Session;
  let plant: Session;
  let prisma: PrismaService;
  let today: string;
  const items: Record<string, Body> = {};
  const suppliers: Record<string, Body> = {};
  const locations: Record<string, Body> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
    purchasing = await signIn(ctx.server, demoEmail('purchasing'));
    approver = await signIn(ctx.server, demoEmail('purchasing_approver'));
    finance = await signIn(ctx.server, demoEmail('finance'));
    plant = await signIn(ctx.server, demoEmail('plant'));
    prisma = ctx.app.get(PrismaService);
    today = dateIn(process.env.COMPANY_TIME_ZONE ?? 'Asia/Bangkok', new Date());
    for (const item of (await as(finance).get('/items').query({ status: 'all' })).body as Body[]) {
      items[item.code] = item;
    }
    for (const s of (await as(purchasing).get('/suppliers').query({ status: 'all' }))
      .body as Body[]) {
      suppliers[s.code] = s;
    }
    for (const l of (await as(finance).get('/locations')).body as Body[]) locations[l.code] = l;
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
      put: (path: string, body: object) =>
        auth(request(ctx.server).put(`${API}${path}`).send(body)),
      patch: (path: string, body: object) =>
        auth(request(ctx.server).patch(`${API}${path}`).send(body)),
    };
  };
  const ok = async (res: request.Response, status = 200): Promise<Body> => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
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
    metric('erp_postings_total', { document_type: 'goods_receipt', outcome: 'refused', rule });
  const linesOf = (event: string, documentNumber: string) =>
    ctx
      .logs()
      .filter((l) => l.labels?.event === event && l.labels?.document_number === documentNumber);
  const trail = async (entityType: string, entityId: string) => {
    const res = await as(admin)
      .get('/audit-logs')
      .query({ entityType, entityId, sortOrder: 'asc' });
    expect(res.status).toBe(200);
    return res.body.data as Body[];
  };

  /** A new account holding the given roles, signed in. */
  const person = async (roles: string[]): Promise<Session> => {
    const email = `${unique('staff').toLowerCase()}@example.test`;
    await ok(
      await as(admin).post('/users', {
        email,
        displayName: 'สมชาย ทดสอบ',
        password: TEST_PASSWORD,
        roles,
      }),
      201,
    );
    return signIn(ctx.server, email, TEST_PASSWORD);
  };

  /**
   * A sent order to the plant: by default 12 cases (240 kg) of whole chicken at 1,284.00 a case,
   * 64.200000 a kg, within the demo threshold so submitting approves it.
   */
  const sentOrder = async (lines?: Body[]): Promise<Body> => {
    let order = await ok(
      await as(purchasing).post('/purchase-orders', {
        supplierId: suppliers['SUP-CHICKEN'].id,
        deliveryLocationId: locations['PLANT-01'].id,
        expectedDeliveryDate: addDays(today, 1),
        lines: lines ?? [
          {
            itemId: items['WHOLE-CHICKEN'].id,
            unitCode: 'case',
            quantity: '12',
            unitPrice: '1284.00',
            vatRate: '7',
            vatRecoverable: true,
          },
        ],
      }),
      201,
    );
    order = await ok(
      await as(purchasing).post(`/purchase-orders/${order.id}/submit`, {
        revision: order.revision,
      }),
    );
    expect(order.status).toBe('approved');
    return ok(
      await as(purchasing).post(`/purchase-orders/${order.id}/send`, { revision: order.revision }),
    );
  };
  /** 8 bags (200 kg) of flour: an item with no receiving tolerances at all. */
  const flourOrder = () =>
    sentOrder([
      {
        itemId: items['FLOUR'].id,
        unitCode: 'bag',
        quantity: '8',
        unitPrice: '812.35',
        vatRate: '7',
        vatRecoverable: true,
      },
    ]);

  /** 240 kg as 132 birds at 2.5 °C, in good order, the supplier's date later than shelf life. */
  const chickenLine = (overrides: Body = {}): Body => ({
    purchaseOrderLineNo: 1,
    unitCode: 'kg',
    countedQuantity: '240',
    countedPieces: '132',
    temperature: '2.5',
    condition: 'good',
    supplierExpiry: addDays(today, 7),
    ...overrides,
  });
  const flourLine = (overrides: Body = {}): Body => ({
    purchaseOrderLineNo: 1,
    unitCode: 'bag',
    countedQuantity: '8',
    condition: 'good',
    ...overrides,
  });

  const draft = async (order: Body, lines: Body[], by: Session = plant): Promise<Body> =>
    ok(await as(by).post('/goods-receipts', { purchaseOrderId: order.id, lines }), 201);
  const step = (by: Session, doc: Body, name: string, extra: Body = {}) =>
    as(by).post(`/goods-receipts/${doc.id}/${name}`, { revision: doc.revision, ...extra });
  const order = async (id: string): Promise<Body> =>
    ok(await as(purchasing).get(`/purchase-orders/${id}`));
  const lotsAtPlant = async (lotNumberPrefix: string): Promise<Body[]> =>
    (
      (
        await ok(
          await as(finance).get('/stock-on-hand').query({ locationId: locations['PLANT-01'].id }),
        )
      ).rows as Body[]
    ).filter((r) => r.lot.number.startsWith(`${lotNumberPrefix}/`));

  describe('the demo seed', () => {
    it('receives the whole-chicken orders: one within tolerance, one warm, approved, part returned', async () => {
      const all = (await ok(await as(finance).get('/goods-receipts'))) as Body[];
      const demo = all.filter((r) => /^Demo seed:/.test(r.note ?? ''));
      expect(demo).toHaveLength(2);
      const [clean, warm] = await Promise.all(
        [...demo]
          .sort((a, b) => a.number.localeCompare(b.number))
          .map(async (r) => ok(await as(finance).get(`/goods-receipts/${r.id}`))),
      );

      expect(clean).toMatchObject({
        status: 'posted',
        needsApproval: false,
        approved: null,
        supplierReturn: null,
        location: { code: 'PLANT-01' },
        createdBy: { displayName: 'Demo plant' },
      });
      expect(clean.lines[0]).toMatchObject({
        acceptedBaseQuantity: '238.400',
        acceptedPieces: '132',
        unitCost: '64.200000',
        findings: [],
        expiry: { expiryDate: addDays(today, 5), takes: 'computed' },
      });
      expect((await order(clean.purchaseOrder.id)).status).toBe('received');

      expect(warm).toMatchObject({
        status: 'posted',
        needsApproval: true,
        approved: { by: { displayName: 'Demo purchasing approver' } },
        createdBy: { displayName: 'Demo plant' },
      });
      expect(warm.lines[0].findings.map((f: Body) => f.code)).toEqual([
        'too_warm',
        'damaged',
        'short_dated',
      ]);
      expect(warm.lines[0]).toMatchObject({
        acceptedBaseQuantity: '384.000',
        acceptedPieces: '213',
        expiry: {
          computedExpiry: addDays(today, 5),
          supplierExpiry: addDays(today, 4),
          expiryDate: addDays(today, 4),
          takes: 'supplier',
        },
      });
      expect(warm.supplierReturn.number).toMatch(RETURN_NUMBER);
      const ret = await ok(await as(finance).get(`/supplier-returns/${warm.supplierReturn.id}`));
      expect(ret.lines).toEqual([
        expect.objectContaining({ quantity: '18.000', secondaryQuantity: '10' }),
      ]);
      const large = await order(warm.purchaseOrder.id);
      expect(large).toMatchObject({ status: 'partially_received' });
      expect(large.lines[0]).toMatchObject({
        receivedQuantity: '384.000',
        returnedQuantity: '18.000',
      });
    });
  });

  describe('a receipt within tolerance', () => {
    it('posts on submission: one lot at the order line cost, the order received, audited and logged', async () => {
      const po = await sentOrder();
      const doc = await draft(po, [chickenLine({ countedQuantity: '238.4' })]);
      expect(doc).toMatchObject({ type: 'goods_receipt', status: 'draft', needsApproval: false });
      expect(doc.number).toMatch(RECEIPT_NUMBER);
      expect(doc.lines[0]).toMatchObject({
        countedBaseQuantity: '238.400',
        expectedBaseQuantity: '240.000',
        findings: [],
        overReceipt: false,
      });
      // A draft affects nothing.
      expect(await lotsAtPlant(doc.number)).toEqual([]);

      const posted = await ok(await step(plant, doc, 'submit'));
      expect(posted).toMatchObject({
        status: 'posted',
        submitted: { by: { displayName: 'Demo plant' } },
        approved: null,
        postingRefusal: null,
        supplierReturn: null,
      });
      expect(posted.lines[0].lot.number).toBe(`${doc.number}/1`);
      expect(posted.totalValue).toBe('15305.28');

      const [lot] = await lotsAtPlant(doc.number);
      expect(lot).toMatchObject({
        quantity: '238.400',
        secondaryQuantity: '132',
        // Stock on hand spells a cost in its shortest exact form (ADR-0019).
        unitCost: '64.2',
        lot: { expiryDate: addDays(today, 5) },
      });
      const after = await order(po.id);
      expect(after.status).toBe('received');
      expect(after.lines[0].receivedQuantity).toBe('238.400');

      expect(linesOf('ledger.posting.succeeded', doc.number)).toHaveLength(1);
      expect((await trail('GoodsReceipt', doc.id)).map((e) => e.action)).toEqual([
        'CREATE',
        'UPDATE',
      ]);
      expect((await trail('PurchaseOrder', po.id)).at(-1)).toMatchObject({
        summary: expect.stringContaining(`Received ${doc.number}`),
      });
    });

    it('converts what was counted in cases with #5 conversion, and lets a later receipt complete the order', async () => {
      const po = await flourOrder();
      const first = await ok(
        await step(plant, await draft(po, [flourLine({ countedQuantity: '5' })]), 'submit'),
      );
      expect(first.lines[0]).toMatchObject({
        countedBaseQuantity: '125.000',
        unitCost: '32.494000',
      });
      expect((await order(po.id)).status).toBe('partially_received');

      const second = await draft(po, [flourLine({ countedQuantity: '75', unitCode: 'kg' })]);
      expect(second.lines[0].expectedBaseQuantity).toBe('75.000');
      await ok(await step(plant, second, 'submit'));
      const after = await order(po.id);
      expect(after.status).toBe('received');
      expect(after.lines[0].receivedQuantity).toBe('200.000');

      // A received order takes no more receipts.
      const more = await as(plant).post('/goods-receipts', {
        purchaseOrderId: po.id,
        lines: [flourLine()],
      });
      expect(more.status).toBe(422);
      expect(more.body.code).toBe('PURCHASE_ORDER_NOT_RECEIVABLE');
    });
  });

  describe('findings', () => {
    const preview = async (po: Body, line: Body): Promise<Body[]> =>
      (
        await ok(
          await as(plant).post('/goods-receipts/preview', {
            purchaseOrderId: po.id,
            lines: [line],
          }),
        )
      ).lines[0].findings;

    it('finds over and under quantity, too warm, damaged and short dated, as the receiver types', async () => {
      const po = await sentOrder();
      expect(await preview(po, chickenLine())).toEqual([]);
      expect(await preview(po, chickenLine({ countedQuantity: '244.8' }))).toEqual([]);
      expect(await preview(po, chickenLine({ countedQuantity: '250' }))).toEqual([
        { code: 'over_quantity', variancePercent: '4.17', limitPercent: '2' },
      ]);
      expect(await preview(po, chickenLine({ countedQuantity: '230' }))).toEqual([
        { code: 'under_quantity', variancePercent: '-4.17', limitPercent: '2' },
      ]);
      expect(await preview(po, chickenLine({ temperature: '4.5' }))).toEqual([
        { code: 'too_warm', temperature: '4.5', limit: '4' },
      ]);
      expect(await preview(po, chickenLine({ condition: 'damaged' }))).toEqual([
        { code: 'damaged' },
      ]);
      expect(await preview(po, chickenLine({ supplierExpiry: addDays(today, 3) }))).toEqual([
        {
          code: 'short_dated',
          supplierExpiry: addDays(today, 3),
          computedExpiry: addDays(today, 5),
        },
      ]);
      // Nothing saved.
      expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } })).toBe(0);
    });

    it('needs a reason, and waits for an approver with the findings fixed as submitted', async () => {
      const po = await sentOrder();
      const warm = await draft(po, [chickenLine({ temperature: '6.1' })]);
      const before = await refusals('reason_required');
      const noReason = await step(plant, warm, 'submit');
      expect(noReason.status).toBe(422);
      expect(noReason.body).toMatchObject({
        code: 'POSTING_REFUSED',
        details: { rule: 'reason_required', lineNo: 1 },
      });
      expect(await refusals('reason_required')).toBe(before + 1);

      const withReason = await ok(
        await as(plant).patch(`/goods-receipts/${warm.id}`, {
          revision: warm.revision,
          lines: [chickenLine({ temperature: '6.1', reason: 'Core 3.9 °C on re-test' })],
        }),
      );
      const submitted = await ok(await step(plant, withReason, 'submit'));
      expect(submitted).toMatchObject({ status: 'submitted', needsApproval: true });
      expect(submitted.lines[0].findings).toEqual([
        { code: 'too_warm', temperature: '6.1', limit: '4' },
      ]);
      // Fixed from here: the lines cannot change.
      const edit = await as(plant).patch(`/goods-receipts/${warm.id}`, {
        revision: submitted.revision,
        note: 'late',
      });
      expect(edit.status).toBe(409);
      expect(await lotsAtPlant(warm.number)).toEqual([]);
    });

    it('requires a temperature where the item has a limit', async () => {
      const po = await sentOrder();
      const doc = await draft(po, [chickenLine({ temperature: null })]);
      const res = await step(plant, doc, 'submit');
      expect(res.status).toBe(422);
      expect(res.body.details).toMatchObject({ rule: 'temperature_required', lineNo: 1 });
    });
  });

  describe('approval (ADR-0008)', () => {
    it('refuses the person who created the receipt, whatever roles they hold, and lets someone else approve', async () => {
      const both = await person(['plant', 'purchasing_approver']);
      const po = await sentOrder();
      const doc = await draft(
        po,
        [chickenLine({ condition: 'damaged', reason: 'Two crushed cases, accepted for stock' })],
        both,
      );
      const submitted = await ok(await step(both, doc, 'submit'));
      expect(submitted.status).toBe('submitted');

      const before = await refusals('self_approval');
      const own = await step(both, submitted, 'approve');
      expect(own.status).toBe(422);
      expect(own.body.details).toMatchObject({ rule: 'self_approval' });
      expect(await refusals('self_approval')).toBe(before + 1);

      // The database refuses it too, for anything that goes around the service.
      const creator = (await prisma.stockDocument.findUniqueOrThrow({ where: { id: doc.id } }))
        .createdById;
      await expect(
        prisma.goodsReceipt.update({
          where: { documentId: doc.id },
          data: { approvedById: creator, approvedAt: new Date() },
        }),
      ).rejects.toThrow(/nobody approves a document they created/);

      // Someone else holding both roles approves, which posts it.
      const other = await person(['plant', 'purchasing_approver']);
      const approved = await ok(await step(other, submitted, 'approve'));
      expect(approved).toMatchObject({ status: 'posted', postingRefusal: null });
      expect(linesOf('document.approved', doc.number)).toHaveLength(1);
      expect(await lotsAtPlant(doc.number)).toHaveLength(1);
    });

    it('lets an approver reject a receipt with a reason: nothing enters stock, nothing on the order', async () => {
      const po = await sentOrder();
      const doc = await draft(po, [chickenLine({ temperature: '9', reason: 'Warm truck' })]);
      const submitted = await ok(await step(plant, doc, 'submit'));
      const blank = await step(approver, submitted, 'reject', { reason: '' });
      expect(blank.status).toBe(422);
      const rejected = await ok(
        await step(approver, submitted, 'reject', { reason: 'Too warm to accept: send it back' }),
      );
      expect(rejected).toMatchObject({
        status: 'rejected',
        rejected: { reason: 'Too warm to accept: send it back' },
      });
      expect(linesOf('document.rejected', doc.number)).toHaveLength(1);
      expect(await lotsAtPlant(doc.number)).toEqual([]);
      const after = await order(po.id);
      expect(after).toMatchObject({ status: 'sent' });
      expect(after.lines[0].receivedQuantity).toBe('0.000');
    });
  });

  describe('rejected quantity', () => {
    it('never enters stock and becomes a return to supplier, visible on the order', async () => {
      const po = await sentOrder();
      const doc = await draft(po, [
        chickenLine({
          rejectedQuantity: '9',
          rejectedPieces: '5',
          reason: 'Five birds with broken skin',
        }),
      ]);
      expect(doc.lines[0]).toMatchObject({
        acceptedBaseQuantity: '231.000',
        acceptedPieces: '127',
      });
      // Rejecting part needs a reason, but no approval: nothing is outside tolerance.
      const posted = await ok(await step(plant, doc, 'submit'));
      expect(posted.status).toBe('posted');
      expect(posted.supplierReturn.number).toMatch(RETURN_NUMBER);

      const [lot] = await lotsAtPlant(doc.number);
      expect(lot).toMatchObject({ quantity: '231.000', secondaryQuantity: '127' });
      const entries = await prisma.ledgerEntry.findMany({ where: { documentId: doc.id } });
      expect(entries).toHaveLength(1);

      const returns = (await ok(
        await as(purchasing).get('/supplier-returns').query({ purchaseOrderId: po.id }),
      )) as Body[];
      expect(returns).toHaveLength(1);
      expect(returns[0]).toMatchObject({
        goodsReceipt: { number: doc.number },
        purchaseOrder: { number: po.number },
        supplier: { code: 'SUP-CHICKEN' },
        lines: [
          expect.objectContaining({
            receiptLineNo: 1,
            quantity: '9.000',
            secondaryQuantity: '5',
            reason: 'Five birds with broken skin',
          }),
        ],
      });
      const after = await order(po.id);
      expect(after.lines[0]).toMatchObject({
        receivedQuantity: '231.000',
        returnedQuantity: '9.000',
      });
      expect(after.status).toBe('partially_received');
      // A return never changes.
      await expect(
        prisma.supplierReturn.update({
          where: { id: returns[0].id },
          data: { businessDate: new Date() },
        }),
      ).rejects.toThrow(/append-only/);
    });

    it('turns away goods the supplier says have already expired: refused while any is accepted', async () => {
      const po = await sentOrder();
      const expired = await draft(po, [
        chickenLine({ supplierExpiry: addDays(today, -1), reason: 'Expired' }),
      ]);
      const refused = await step(plant, expired, 'submit');
      expect(refused.status).toBe(422);
      expect(refused.body.details).toMatchObject({ rule: 'expired_on_arrival' });

      const all = await ok(
        await as(plant).patch(`/goods-receipts/${expired.id}`, {
          revision: expired.revision,
          lines: [
            chickenLine({
              supplierExpiry: addDays(today, -1),
              rejectedQuantity: '240',
              rejectedPieces: '132',
              reason: 'Expired yesterday: all returned',
            }),
          ],
        }),
      );
      const submitted = await ok(await step(plant, all, 'submit'));
      expect(submitted.status).toBe('submitted');
      const posted = await ok(await step(approver, submitted, 'approve'));
      expect(posted.status).toBe('posted');
      expect(await prisma.lot.count({ where: { originDocumentId: expired.id } })).toBe(0);
      expect(posted.supplierReturn).not.toBeNull();
    });
  });

  describe('how much an order line may receive', () => {
    it('refuses more than ordered plus the variance limit, and exactly ordered without one', async () => {
      const chicken = await sentOrder();
      const tooMuch = await draft(chicken, [
        chickenLine({ countedQuantity: '244.801', reason: 'Heavier birds' }),
      ]);
      expect(tooMuch.lines[0].overReceipt).toBe(true);
      const before = await refusals('over_receipt');
      const res = await step(plant, tooMuch, 'submit');
      expect(res.status).toBe(422);
      expect(res.body.details).toMatchObject({ rule: 'over_receipt', lineNo: 1 });
      expect(await refusals('over_receipt')).toBe(before + 1);

      const flour = await flourOrder();
      const nine = await draft(flour, [flourLine({ countedQuantity: '9' })]);
      expect((await step(plant, nine, 'submit')).body.details).toMatchObject({
        rule: 'over_receipt',
      });
      // Turning the extra bag away receives exactly what was ordered.
      const fixed = await ok(
        await as(plant).patch(`/goods-receipts/${nine.id}`, {
          revision: nine.revision,
          lines: [
            flourLine({ countedQuantity: '9', rejectedQuantity: '1', reason: 'One bag too many' }),
          ],
        }),
      );
      expect((await ok(await step(plant, fixed, 'submit'))).status).toBe('posted');
      expect((await order(flour.id)).status).toBe('received');
    });

    it('never lets two receipts posted at once together exceed the order line', async () => {
      const flour = await flourOrder();
      const a = await draft(flour, [flourLine({ countedQuantity: '6' })]);
      const b = await draft(flour, [flourLine({ countedQuantity: '6' })]);
      const results = await Promise.all([step(plant, a, 'submit'), step(plant, b, 'submit')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
      const refused = results.find((r) => r.status === 422)!;
      expect(refused.body.details).toMatchObject({ rule: 'over_receipt' });

      const after = await order(flour.id);
      expect(after.lines[0].receivedQuantity).toBe('150.000');
      expect(after.status).toBe('partially_received');
      const posted = await prisma.stockDocument.count({
        where: { id: { in: [a.id, b.id] }, status: 'posted' },
      });
      expect(posted).toBe(1);
    });
  });

  describe('what a receipt may record', () => {
    it('counts in the ordered unit or the base unit, with pieces for a variable-weight item', async () => {
      const po = await sentOrder();
      const badUnit = await as(plant).post('/goods-receipts', {
        purchaseOrderId: po.id,
        lines: [chickenLine({ unitCode: 'piece' })],
      });
      expect(badUnit.status).toBe(422);
      expect(badUnit.body.code).toBe('NOT_A_RECEIVING_UNIT');

      const noPieces = await as(plant).post('/goods-receipts', {
        purchaseOrderId: po.id,
        lines: [chickenLine({ countedPieces: null })],
      });
      expect(noPieces.status).toBe(422);
      expect(noPieces.body.details).toMatchObject({ problem: 'PIECES_REQUIRED' });

      const unknownLine = await as(plant).post('/goods-receipts', {
        purchaseOrderId: po.id,
        lines: [chickenLine({ purchaseOrderLineNo: 2 })],
      });
      expect(unknownLine.body.code).toBe('UNKNOWN_ORDER_LINE');

      const twice = await as(plant).post('/goods-receipts', {
        purchaseOrderId: po.id,
        lines: [chickenLine(), chickenLine()],
      });
      expect(twice.body.code).toBe('DUPLICATE_ORDER_LINE');
    });

    it('receives only against an approved or sent order, checked again when it posts', async () => {
      const draftOrder = await ok(
        await as(purchasing).post('/purchase-orders', {
          supplierId: suppliers['SUP-CHICKEN'].id,
          deliveryLocationId: locations['PLANT-01'].id,
          expectedDeliveryDate: addDays(today, 1),
          lines: [
            {
              itemId: items['WHOLE-CHICKEN'].id,
              unitCode: 'case',
              quantity: '1',
              unitPrice: '1284.00',
              vatRate: '7',
              vatRecoverable: true,
            },
          ],
        }),
        201,
      );
      const res = await as(plant).post('/goods-receipts', {
        purchaseOrderId: draftOrder.id,
        lines: [chickenLine()],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PURCHASE_ORDER_NOT_RECEIVABLE');

      const po = await sentOrder();
      const doc = await draft(po, [chickenLine()]);
      await ok(
        await as(purchasing).post(`/purchase-orders/${po.id}/cancel`, {
          revision: po.revision,
          reason: 'Supplier cannot deliver',
        }),
      );
      const late = await step(plant, doc, 'submit');
      expect(late.status).toBe(422);
      expect(late.body.details).toMatchObject({ rule: 'order_not_receivable' });
    });
  });

  describe('receiving tolerances', () => {
    it('are configuration the admin maintains, audited, without a master data version', async () => {
      const item = (await ok(await as(admin).get(`/items/${items['FLOUR'].id}`))) as Body;
      expect(item.receivingTolerances).toEqual({ maxVariancePercent: null, maxTemperature: null });

      expect(
        (await as(plant).put(`/items/${item.id}/receiving-tolerances`, { maxVariancePercent: '1' }))
          .status,
      ).toBe(403);
      const bad = await as(admin).put(`/items/${item.id}/receiving-tolerances`, {
        maxVariancePercent: '120',
      });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('INVALID_RECEIVING_TOLERANCES');

      const set = await ok(
        await as(admin).put(`/items/${item.id}/receiving-tolerances`, {
          maxVariancePercent: '1.50',
          maxTemperature: '25.0',
        }),
      );
      expect(set.receivingTolerances).toEqual({ maxVariancePercent: '1.5', maxTemperature: '25' });
      expect(set.version).toBe(item.version);
      expect((await trail('Item', item.id)).at(-1)).toMatchObject({
        summary: expect.stringContaining('receiving tolerances'),
      });

      const cleared = await ok(
        await as(admin).put(`/items/${item.id}/receiving-tolerances`, {
          maxVariancePercent: null,
          maxTemperature: null,
        }),
      );
      expect(cleared.receivingTolerances).toEqual({
        maxVariancePercent: null,
        maxTemperature: null,
      });
    });
  });

  describe('permissions', () => {
    it('lets the plant receive, approvers approve, and purchasing and finance read', async () => {
      const po = await sentOrder();
      const create = { purchaseOrderId: po.id, lines: [chickenLine()] };
      expect((await as(finance).post('/goods-receipts', create)).status).toBe(403);
      expect((await as(purchasing).post('/goods-receipts', create)).status).toBe(403);
      expect((await as(approver).post('/goods-receipts', create)).status).toBe(403);
      expect((await as(null).get('/goods-receipts')).status).toBe(401);
      for (const reader of [plant, purchasing, approver, finance]) {
        expect((await as(reader).get('/goods-receipts')).status).toBe(200);
        expect((await as(reader).get('/supplier-returns')).status).toBe(200);
      }
      const doc = await draft(po, [chickenLine({ condition: 'damaged', reason: 'Dented cases' })]);
      const submitted = await ok(await step(plant, doc, 'submit'));
      expect((await step(plant, submitted, 'approve')).status).toBe(403);
      expect((await step(finance, submitted, 'approve')).status).toBe(403);

      const filtered = (await ok(
        await as(finance)
          .get('/goods-receipts')
          .query({ status: 'submitted', purchaseOrderId: po.id }),
      )) as Body[];
      expect(filtered.map((r) => r.number)).toEqual([doc.number]);
    });
  });
});

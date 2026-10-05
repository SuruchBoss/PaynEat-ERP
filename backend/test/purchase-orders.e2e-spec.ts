// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Purchase orders (#10), end to end against a real PostgreSQL: draft → submitted → approved →
 * sent, or rejected, or cancelled; at or below the company's approval threshold submitting
 * approves; above it a purchasing approver does, never the person who created the order, whatever
 * roles they hold (ADR-0008); inactive suppliers and items cannot be ordered; every transition
 * audited and logged with the document number; nothing written to the ledger.
 */
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { addDays, dateIn } from 'src/core/time/domain/business-date';
import { thaiTaxIdCheckDigit } from 'src/modules/suppliers/domain/thai-tax-id';
import { DEMO_PURCHASE_APPROVAL_THRESHOLD } from '../prisma/seed';
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

const DOCUMENT_NUMBER = /^PO-\d{4}-\d{5}$/;

describe('purchase orders', () => {
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
      patch: (path: string, body: object) =>
        auth(request(ctx.server).patch(`${API}${path}`).send(body)),
    };
  };

  /** 12 cases of whole chicken at 1,284.00: gross 16,486.56, within the demo threshold. */
  const chickenLine = (overrides: Body = {}): Body => ({
    itemId: items['WHOLE-CHICKEN'].id,
    unitCode: 'case',
    quantity: '12',
    unitPrice: '1284.00',
    vatRate: '7',
    vatRecoverable: true,
    ...overrides,
  });

  const order = (overrides: Body = {}): Body => ({
    supplierId: suppliers['SUP-CHICKEN'].id,
    deliveryLocationId: locations['PLANT-01'].id,
    expectedDeliveryDate: addDays(today, 2),
    lines: [chickenLine()],
    ...overrides,
  });

  const draft = async (by: Session, overrides: Body = {}): Promise<Body> => {
    const res = await as(by).post('/purchase-orders', order(overrides));
    expect(res.status).toBe(201);
    return res.body;
  };
  const step = (by: Session, doc: Body, name: string, extra: Body = {}) =>
    as(by).post(`/purchase-orders/${doc.id}/${name}`, { revision: doc.revision, ...extra });
  const ok = async (res: request.Response): Promise<Body> => {
    expect(res.status).toBe(200);
    return res.body;
  };

  const linesOf = (event: string, documentNumber: string) =>
    ctx
      .logs()
      .filter((l) => l.labels?.event === event && l.labels?.document_number === documentNumber);
  const trail = async (entityId: string) => {
    const res = await as(admin)
      .get('/audit-logs')
      .query({ entityType: 'PurchaseOrder', entityId, sortOrder: 'asc' });
    expect(res.status).toBe(200);
    return res.body.data as Body[];
  };

  /** A new account holding the given roles, signed in. */
  const person = async (roles: string[]): Promise<Session> => {
    const email = `${unique('staff').toLowerCase()}@example.test`;
    const res = await as(admin).post('/users', {
      email,
      displayName: 'สมหญิง ทดสอบ',
      password: TEST_PASSWORD,
      roles,
    });
    expect(res.status).toBe(201);
    return signIn(ctx.server, email, TEST_PASSWORD);
  };

  const newSupplier = async (): Promise<Body> => {
    const first12 = `00000${String(Date.now() % 10_000_000).padStart(7, '0')}`;
    const res = await as(purchasing).post('/suppliers', {
      code: unique('SUP'),
      name: 'บริษัท ทดสอบ จำกัด (สมมติ)',
      taxId: `${first12}${thaiTaxIdCheckDigit(first12)}`,
    });
    expect(res.status).toBe(201);
    return res.body;
  };

  const newItem = async (): Promise<Body> => {
    const res = await as(admin).post('/items', {
      code: unique('IT'),
      nameTh: 'สินค้าทดสอบ',
      nameEn: 'Test item',
      baseUnitCode: 'kg',
      variableWeight: false,
      shelfLifeDays: 30,
      purchaseUnits: [{ unitCode: 'bag', factor: '25' }],
    });
    expect(res.status).toBe(201);
    return res.body;
  };

  describe('the demo seed', () => {
    it('sets a 20,000 threshold and adds two chicken orders, one approved automatically and one by the approver, and a flour and oil draft', async () => {
      const settings = await as(purchasing).get('/company/settings');
      expect(settings.status).toBe(200);
      expect(settings.body).toMatchObject({
        purchaseApprovalThreshold: DEMO_PURCHASE_APPROVAL_THRESHOLD,
        revision: 1,
      });

      const res = await as(finance).get('/purchase-orders');
      expect(res.status).toBe(200);
      const details = await Promise.all(
        (res.body as Body[]).map(
          async (o) => (await as(finance).get(`/purchase-orders/${o.id}`)).body as Body,
        ),
      );
      const demo = details.filter((o) => /^Demo seed:/.test(o.note ?? ''));
      expect(demo).toHaveLength(3);

      const small = demo.find((o) => o.totals.gross === '16486.56')!;
      expect(small).toMatchObject({
        status: 'sent',
        supplier: { code: 'SUP-CHICKEN' },
        deliveryLocation: { code: 'PLANT-01' },
        approved: { by: null, automatically: true },
        submitted: { by: { displayName: 'Demo purchasing' }, approvalThreshold: '20000.00' },
      });
      const large = demo.find((o) => o.totals.gross === '27477.60')!;
      expect(large).toMatchObject({
        status: 'sent',
        approved: { by: { displayName: 'Demo purchasing approver' }, automatically: false },
        createdBy: { displayName: 'Demo purchasing' },
      });
      const dry = demo.find((o) => o.supplier.code === 'SUP-DRYGOODS')!;
      expect(dry).toMatchObject({ status: 'draft', submitted: null });
      expect(dry.lines.map((l: Body) => l.item.code)).toEqual(['FLOUR', 'FRYING-OIL']);
    });
  });

  describe('drafts and their money', () => {
    it('drafts an order with its totals, base quantities and cost per base unit (ADR-0024)', async () => {
      const doc = await draft(purchasing, {
        lines: [
          chickenLine(),
          {
            itemId: items['FLOUR'].id,
            unitCode: 'bag',
            quantity: '7',
            unitPrice: '812.35',
            vatRate: '7',
            vatRecoverable: false,
          },
        ],
        note: '  for the weekend  ',
      });
      expect(doc.number).toMatch(DOCUMENT_NUMBER);
      expect(doc).toMatchObject({
        status: 'draft',
        revision: 1,
        note: 'for the weekend',
        expectedDeliveryDate: addDays(today, 2),
        createdBy: { id: purchasing.user.id },
        totals: { net: '21094.45', vat: '1476.61', gross: '22571.06' },
        approval: { threshold: '20000.00', needsApprover: true },
      });
      expect(doc.lines).toMatchObject([
        {
          lineNo: 1,
          item: { code: 'WHOLE-CHICKEN' },
          unit: { code: 'case' },
          factor: '20',
          quantity: '12',
          net: '15408.00',
          vat: '1078.56',
          gross: '16486.56',
          baseQuantity: '240.000',
          unitCost: '64.200000',
        },
        {
          lineNo: 2,
          item: { code: 'FLOUR' },
          factor: '25',
          net: '5686.45',
          vat: '398.05',
          gross: '6084.50',
          baseQuantity: '175.000',
          // VAT not recoverable is part of the cost: 812.35 × 1.07 / 25.
          unitCost: '34.768580',
        },
      ]);
      expect(await trail(doc.id)).toMatchObject([
        { action: 'CREATE', summary: `Drafted purchase order ${doc.number}` },
      ]);
    });

    it('edits a draft, replacing its lines, and refuses an edit made from an older revision', async () => {
      const doc = await draft(purchasing);
      const edited = await as(purchasing).patch(`/purchase-orders/${doc.id}`, {
        revision: doc.revision,
        lines: [chickenLine({ quantity: '3' })],
        expectedDeliveryDate: addDays(today, 4),
      });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({
        revision: 2,
        expectedDeliveryDate: addDays(today, 4),
        totals: { net: '3852.00' },
      });
      const stale = await as(purchasing).patch(`/purchase-orders/${doc.id}`, {
        revision: doc.revision,
        note: 'too late',
      });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ code: 'PURCHASE_ORDER_CHANGED' });
    });

    it.each([
      [
        'a quantity finer than its unit',
        { lines: [{ quantity: '2.5' }] },
        'INVALID_PURCHASE_ORDER_LINE',
      ],
      ['a price of zero', { lines: [{ unitPrice: '0' }] }, 'INVALID_PURCHASE_ORDER_LINE'],
      ['a VAT rate over 100%', { lines: [{ vatRate: '107' }] }, 'INVALID_PURCHASE_ORDER_LINE'],
      ['a unit the item is not bought in', { lines: [{ unitCode: 'bag' }] }, 'NOT_A_PURCHASE_UNIT'],
      ['a delivery date in the past', { expectedDeliveryDate: 'yesterday' }, 'DELIVERY_DATE_PAST'],
      ['a delivery to a branch', { deliveryLocationId: 'BR-SILOM' }, 'LOCATION_NOT_RECEIVING'],
    ])('refuses %s', async (_name, overrides, code) => {
      const body: Body = order();
      const o = overrides as Body;
      if (o.lines) body.lines = [chickenLine(o.lines[0])];
      if (o.expectedDeliveryDate) body.expectedDeliveryDate = addDays(today, -1);
      if (o.deliveryLocationId) body.deliveryLocationId = locations[o.deliveryLocationId].id;
      const res = await as(purchasing).post('/purchase-orders', body);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code });
    });
  });

  describe('the approval threshold', () => {
    it('is read by anyone signed in, changed only by the admin, audited, and refuses a stale or negative value', async () => {
      const current = (await as(admin).get('/company/settings')).body;
      expect((await as(purchasing).patch('/company/settings', { ...current })).status).toBe(403);

      const negative = await as(admin).patch('/company/settings', {
        revision: current.revision,
        purchaseApprovalThreshold: '-1',
      });
      expect(negative.status).toBe(422);
      expect(negative.body).toMatchObject({ code: 'INVALID_APPROVAL_THRESHOLD' });

      const changed = await as(admin).patch('/company/settings', {
        revision: current.revision,
        purchaseApprovalThreshold: '25000',
      });
      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({
        purchaseApprovalThreshold: '25000.00',
        revision: current.revision + 1,
      });
      const stale = await as(admin).patch('/company/settings', {
        revision: current.revision,
        purchaseApprovalThreshold: '1',
      });
      expect(stale.status).toBe(409);

      const audit = await as(admin)
        .get('/audit-logs')
        .query({ entityType: 'CompanySettings', sortOrder: 'desc' });
      expect(audit.body.data[0]).toMatchObject({
        action: 'UPDATE',
        summary: 'Set the purchase approval threshold to 25000',
      });

      const back = await as(admin).patch('/company/settings', {
        revision: changed.body.revision,
        purchaseApprovalThreshold: DEMO_PURCHASE_APPROVAL_THRESHOLD,
      });
      expect(back.status).toBe(200);
    });

    it('approves on submission an order at or below the threshold, with no approver', async () => {
      const doc = await draft(purchasing);
      const submitted = await ok(await step(purchasing, doc, 'submit'));
      expect(submitted).toMatchObject({
        status: 'approved',
        submitted: { by: { id: purchasing.user.id }, approvalThreshold: '20000.00' },
        approved: { by: null, automatically: true },
        approval: { threshold: '20000.00', needsApprover: false },
      });
      expect(linesOf('document.approved', doc.number)).toMatchObject([
        { severity: 'INFO', labels: { document_number: doc.number, location_code: 'PLANT-01' } },
      ]);
      expect(await trail(doc.id)).toMatchObject([
        { action: 'CREATE' },
        { action: 'APPROVE', changes: { status: { from: 'draft', to: 'approved' } } },
      ]);
    });

    it('sends an order above the threshold to an approver, who approves it; then it is sent', async () => {
      const doc = await draft(purchasing, { lines: [chickenLine({ quantity: '20' })] });
      const submitted = await ok(await step(purchasing, doc, 'submit'));
      expect(submitted).toMatchObject({
        status: 'submitted',
        totals: { gross: '27477.60' },
        approved: null,
        approval: { threshold: '20000.00', needsApprover: true },
      });
      expect(linesOf('document.approved', doc.number)).toEqual([]);

      // Purchasing cannot approve; an approver can.
      expect((await step(purchasing, submitted, 'approve')).status).toBe(403);
      const approved = await ok(await step(approver, submitted, 'approve'));
      expect(approved).toMatchObject({
        status: 'approved',
        approved: { by: { id: approver.user.id }, automatically: false },
      });
      expect(linesOf('document.approved', doc.number)).toHaveLength(1);

      // After submission an order changes only by cancelling it.
      const edit = await as(purchasing).patch(`/purchase-orders/${doc.id}`, {
        revision: approved.revision,
        note: 'changed',
      });
      expect(edit.status).toBe(409);
      expect(edit.body).toMatchObject({ code: 'STEP_NOT_ALLOWED' });

      const sent = await ok(await step(purchasing, approved, 'send'));
      expect(sent).toMatchObject({ status: 'sent', sent: { by: { id: purchasing.user.id } } });
      expect((await trail(doc.id)).map((e) => e.action)).toEqual([
        'CREATE',
        'UPDATE',
        'APPROVE',
        'UPDATE',
      ]);
      // A purchase order commits money, not stock: nothing reached the ledger.
      const entries = await prisma.stockDocument.count({ where: { number: doc.number } });
      expect(entries).toBe(0);
    });

    it('is judged when the order is submitted, and the threshold it was judged against is kept', async () => {
      const doc = await draft(purchasing, { lines: [chickenLine({ quantity: '13' })] });
      // 13 cases: gross 17,860.44 — within 20,000 but above 15,000.
      const current = (await as(admin).get('/company/settings')).body;
      const lowered = await as(admin).patch('/company/settings', {
        revision: current.revision,
        purchaseApprovalThreshold: '15000',
      });
      expect(lowered.status).toBe(200);
      try {
        const submitted = await ok(await step(purchasing, doc, 'submit'));
        expect(submitted).toMatchObject({
          status: 'submitted',
          submitted: { approvalThreshold: '15000.00' },
        });
      } finally {
        await as(admin).patch('/company/settings', {
          revision: lowered.body.revision,
          purchaseApprovalThreshold: DEMO_PURCHASE_APPROVAL_THRESHOLD,
        });
      }
    });
  });

  describe('rejection and cancellation', () => {
    it('rejects a submitted order with a reason, finally, and logs it', async () => {
      const doc = await draft(purchasing, { lines: [chickenLine({ quantity: '20' })] });
      const submitted = await ok(await step(purchasing, doc, 'submit'));
      const noReason = await step(approver, submitted, 'reject', { reason: '  ' });
      expect(noReason.status).toBe(422);
      expect(noReason.body).toMatchObject({ code: 'REJECTION_REASON_MISSING' });

      const rejected = await ok(
        await step(approver, submitted, 'reject', { reason: 'Price above the agreed rate' }),
      );
      expect(rejected).toMatchObject({
        status: 'rejected',
        rejected: { by: { id: approver.user.id }, reason: 'Price above the agreed rate' },
      });
      expect(linesOf('document.rejected', doc.number)).toMatchObject([
        { severity: 'INFO', labels: { document_number: doc.number } },
      ]);
      for (const name of ['approve', 'send', 'cancel']) {
        const res = await step(
          name === 'approve' ? approver : purchasing,
          rejected,
          name,
          name === 'cancel' ? { reason: 'x' } : {},
        );
        expect(res.status).toBe(409);
      }
    });

    it('cancels a draft, a submitted or a sent order with a reason; a cancelled one is final', async () => {
      const a = await draft(purchasing);
      const cancelledDraft = await ok(
        await step(purchasing, a, 'cancel', { reason: 'Ordered by mistake' }),
      );
      expect(cancelledDraft).toMatchObject({
        status: 'cancelled',
        cancelled: { by: { id: purchasing.user.id }, reason: 'Ordered by mistake' },
      });
      expect((await step(purchasing, cancelledDraft, 'submit')).status).toBe(409);

      const b = await draft(purchasing);
      const sent = await ok(
        await step(purchasing, await ok(await step(purchasing, b, 'submit')), 'send'),
      );
      const noReason = await step(purchasing, sent, 'cancel', { reason: '' });
      expect(noReason.status).toBe(422);
      const cancelledSent = await ok(
        await step(purchasing, sent, 'cancel', { reason: 'Supplier cannot deliver' }),
      );
      expect(cancelledSent.status).toBe('cancelled');
      expect((await trail(b.id)).at(-1)).toMatchObject({
        action: 'UPDATE',
        changes: { status: { from: 'sent', to: 'cancelled' } },
      });
    });
  });

  describe('segregation of duties (ADR-0008)', () => {
    it('refuses the creator even when they hold both roles, and lets someone else approve', async () => {
      const both = await person(['purchasing', 'purchasing_approver']);
      expect(both.user.permissions).toEqual(
        expect.arrayContaining(['purchase_order:raise', 'purchase_order:approve']),
      );
      const doc = await draft(both, { lines: [chickenLine({ quantity: '20' })] });
      const submitted = await ok(await step(both, doc, 'submit'));

      const self = await step(both, submitted, 'approve');
      expect(self.status).toBe(422);
      expect(self.body).toMatchObject({
        code: 'PURCHASE_ORDER_REFUSED',
        details: { rule: 'self_approval' },
      });
      const unchanged = (await as(finance).get(`/purchase-orders/${doc.id}`)).body;
      expect(unchanged).toMatchObject({ status: 'submitted', revision: submitted.revision });

      // The same person approves someone else's order.
      const others = await ok(
        await step(
          purchasing,
          await draft(purchasing, { lines: [chickenLine({ quantity: '20' })] }),
          'submit',
        ),
      );
      expect((await step(both, others, 'approve')).status).toBe(200);

      // And someone else approves theirs.
      const byOther = await ok(await step(approver, submitted, 'approve'));
      expect(byOther).toMatchObject({
        status: 'approved',
        approved: { by: { id: approver.user.id } },
      });
    });

    it('is kept by the database too, for anything that goes around the service', async () => {
      const doc = await draft(purchasing, { lines: [chickenLine({ quantity: '20' })] });
      await ok(await step(purchasing, doc, 'submit'));
      await expect(prisma.$executeRaw`
        UPDATE "purchase_orders" SET "approved_by_id" = ${purchasing.user.id}::uuid,
          "approved_at" = now(), "status" = 'approved' WHERE "id" = ${doc.id}::uuid
      `).rejects.toThrow(/nobody approves an order they created/);
      await expect(prisma.$executeRaw`
        UPDATE "purchase_order_lines" SET "quantity" = 1 WHERE "purchase_order_id" = ${doc.id}::uuid
      `).rejects.toThrow(/lines are fixed once it leaves draft/);
      await expect(prisma.$executeRaw`
        DELETE FROM "purchase_orders" WHERE "id" = ${doc.id}::uuid
      `).rejects.toThrow(/never deleted/);
    });
  });

  describe('what can be ordered', () => {
    it('refuses an inactive supplier and an inactive item, on drafting and again on submission', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const doc = await draft(purchasing, {
        supplierId: supplier.id,
        lines: [
          {
            itemId: item.id,
            unitCode: 'bag',
            quantity: '2',
            unitPrice: '500',
            vatRate: '7',
            vatRecoverable: true,
          },
        ],
      });

      const deactivated = await as(purchasing).patch(`/suppliers/${supplier.id}`, {
        revision: supplier.revision,
        active: false,
      });
      expect(deactivated.status).toBe(200);
      const refused = await step(purchasing, doc, 'submit');
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({
        code: 'PURCHASE_ORDER_REFUSED',
        details: { rule: 'inactive_supplier' },
      });
      const again = await as(purchasing).post(
        '/purchase-orders',
        order({ supplierId: supplier.id }),
      );
      expect(again.status).toBe(422);
      expect(again.body).toMatchObject({ code: 'SUPPLIER_INACTIVE' });

      await as(purchasing).patch(`/suppliers/${supplier.id}`, {
        revision: deactivated.body.revision,
        active: true,
      });
      const itemOff = await as(admin).patch(`/items/${item.id}`, {
        version: item.version,
        active: false,
      });
      expect(itemOff.status).toBe(200);
      const refusedItem = await step(purchasing, doc, 'submit');
      expect(refusedItem.status).toBe(422);
      expect(refusedItem.body).toMatchObject({
        details: { rule: 'inactive_item', lineNo: 1 },
      });
      const draftWithItem = await as(purchasing).post(
        '/purchase-orders',
        order({ lines: [chickenLine({ itemId: item.id, unitCode: 'bag' })] }),
      );
      expect(draftWithItem.status).toBe(422);
      expect(draftWithItem.body).toMatchObject({ code: 'ITEM_INACTIVE' });
    });
  });

  describe('permissions', () => {
    it('lets purchasing, approvers and finance read; only purchasing raise; nobody else in', async () => {
      expect((await as(plant).get('/purchase-orders')).status).toBe(403);
      expect((await as(finance).get('/purchase-orders')).status).toBe(200);
      expect((await as(approver).get('/purchase-orders')).status).toBe(200);
      expect((await as(finance).post('/purchase-orders', order())).status).toBe(403);
      expect((await as(approver).post('/purchase-orders', order())).status).toBe(403);
      expect((await as(null).get('/purchase-orders')).status).toBe(401);

      const filtered = await as(finance).get('/purchase-orders').query({ status: 'draft' });
      expect(filtered.status).toBe(200);
      expect((filtered.body as Body[]).every((o) => o.status === 'draft')).toBe(true);
    });
  });
});

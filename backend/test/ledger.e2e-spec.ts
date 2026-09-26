// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The stock ledger and opening balances (#7), end to end against a real PostgreSQL: drafts,
 * posting in one transaction, the rules that refuse a posting (logged and counted), ledger
 * entries nothing can change, reversals (once, even when two arrive together), stock on hand
 * as of any date by business time, and a rebuild of the balances that equals the snapshot.
 */
import request from 'supertest';
import { addDays } from 'src/core/time/domain/business-date';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { LedgerService } from 'src/modules/ledger/ledger.service';
import { DEMO_OPENING_BALANCE } from '../prisma/seed';
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

const DOCUMENT_NUMBER = /^OB-\d{4}-\d{5}$/;
const REVERSAL_NUMBER = /^RV-\d{4}-\d{5}$/;

describe('stock ledger and opening balances', () => {
  let ctx: TestContext;
  let admin: Session;
  let plant: Session;
  let finance: Session;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let today: string;
  const items: Record<string, Body> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await signInAsAdmin(ctx.server);
    plant = await signIn(ctx.server, demoEmail('plant'));
    finance = await signIn(ctx.server, demoEmail('finance'));
    prisma = ctx.app.get(PrismaService);
    ledger = ctx.app.get(LedgerService);
    today = ledger.today();
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

  const chicken = (overrides: Body = {}): Body => ({
    itemId: items['WHOLE-CHICKEN'].id,
    quantity: '21.6',
    secondaryQuantity: '12',
    unitCost: '72.5',
    expiryDate: addDays(today, 3),
    ...overrides,
  });
  const flour = (overrides: Body = {}): Body => ({
    itemId: items.FLOUR.id,
    quantity: '250',
    unitCost: '32.5',
    expiryDate: addDays(today, 150),
    ...overrides,
  });
  const drumsticks = (overrides: Body = {}): Body => ({
    itemId: items['CHICKEN-DRUMSTICK'].id,
    quantity: '40',
    unitCost: '3.25',
    expiryDate: addDays(today, 2),
    ...overrides,
  });

  const draft = async (locationId: string, lines: Body[], extra: Body = {}): Promise<Body> => {
    const res = await as(plant).post('/opening-balances', { locationId, lines, ...extra });
    expect(res.status).toBe(201);
    return res.body;
  };
  const post = (doc: Body, requestId?: string) => {
    const req = as(plant).post(`/opening-balances/${doc.id}/post`, { revision: doc.revision });
    return requestId ? req.set('x-request-id', requestId) : req;
  };
  const posted = async (locationId: string, lines: Body[], extra: Body = {}): Promise<Body> => {
    const res = await post(await draft(locationId, lines, extra));
    expect(res.status).toBe(200);
    return res.body;
  };
  const reverse = (id: string, body: Body = {}) =>
    as(plant).post(`/opening-balances/${id}/reverse`, body);
  const stock = async (query: Body): Promise<Body> => {
    const res = await as(finance).get('/stock-on-hand').query(query);
    expect(res.status).toBe(200);
    return res.body;
  };

  const entriesOf = (documentId: string) =>
    prisma.$queryRaw<Body[]>`
      SELECT "id", "lot_id" AS "lotId", "location_id" AS "locationId", "quantity"::text AS "quantity",
             "secondary_quantity"::text AS "secondaryQuantity", "unit_cost"::text AS "unitCost",
             "business_time" AS "businessTime", "posted_at" AS "postedAt",
             "posted_by_id" AS "postedById", "reverses_entry_id" AS "reversesEntryId"
      FROM "ledger_entries" WHERE "document_id" = ${documentId}::uuid ORDER BY "line_no"
    `;

  const postings = async (labels: Record<string, string>): Promise<number> => {
    const text = (await request(`http://127.0.0.1:${ctx.metricsPort}`).get('/metrics')).text;
    const wanted = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    const line = text
      .split('\n')
      .find((l) => l.startsWith('erp_postings_total{') && wanted.every((w) => l.includes(w)));
    return line ? Number(line.split(' ').pop()) : 0;
  };
  const linesOf = (event: string, documentNumber: string) =>
    ctx
      .logs()
      .filter((l) => l.labels?.event === event && l.labels?.document_number === documentNumber);

  /**
   * A stand-in for a consumption, which later tickets post through the ledger: takes stock
   * out of a lot directly, entry and balance together, as the ledger itself would.
   */
  const consume = async (lotId: string, locationId: string, quantity: string) => {
    counter += 1;
    const number = `TC-${today.slice(0, 4)}-${String(Date.now()).slice(-7)}${counter}`;
    await prisma.$transaction(async (tx) => {
      const [doc] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "stock_documents" ("id", "number", "type", "status", "business_date",
          "revision", "created_by_id", "posted_by_id", "posted_at", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${number}, 'opening_balance', 'posted', ${today}::date, 1,
          ${plant.user.id}::uuid, ${plant.user.id}::uuid, now(), now(), now())
        RETURNING "id"
      `;
      await tx.$executeRaw`
        INSERT INTO "ledger_entries" ("id", "document_id", "line_no", "item_id", "lot_id",
          "location_id", "quantity", "unit_cost", "business_time", "posted_by_id", "posted_at")
        SELECT gen_random_uuid(), ${doc.id}::uuid, 1, "item_id", "id", ${locationId}::uuid,
          -${quantity}::numeric, "unit_cost", now(), ${plant.user.id}::uuid, now()
        FROM "lots" WHERE "id" = ${lotId}::uuid
      `;
      await tx.$executeRaw`
        UPDATE "stock_balances" SET "quantity" = "quantity" - ${quantity}::numeric
        WHERE "lot_id" = ${lotId}::uuid AND "location_id" = ${locationId}::uuid
      `;
    });
  };

  describe('the demo seed', () => {
    it("posts the plant's opening balance: flour, oil, and whole chickens expiring on different days", async () => {
      const plants = (await as(finance).get('/locations').query({ type: 'plant' })).body as Body[];
      const plantId = plants.find((l) => l.code === DEMO_OPENING_BALANCE.locationCode)!.id;

      const list = (await as(finance).get('/opening-balances').query({ locationId: plantId }))
        .body as Body[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        status: 'posted',
        lineCount: 5,
        businessDate: addDays(today, -1),
        reversedBy: null,
        createdBy: { displayName: 'Demo plant' },
      });
      expect(list[0].number).toMatch(DOCUMENT_NUMBER);

      const rows = (await stock({ locationId: plantId })).rows as Body[];
      expect(rows.map((r) => r.item.code).sort()).toEqual([
        'FLOUR',
        'FRYING-OIL',
        'WHOLE-CHICKEN',
        'WHOLE-CHICKEN',
        'WHOLE-CHICKEN',
      ]);
      const chickens = rows.filter((r) => r.item.code === 'WHOLE-CHICKEN');
      expect(new Set(chickens.map((r) => r.lot.expiryDate)).size).toBe(3);
      expect(chickens.map((r) => r.secondaryQuantity).sort()).toEqual(['10', '12', '24']);
    });
  });

  describe('drafts', () => {
    it('are numbered at once, edited freely, and affect nothing', async () => {
      const location = await newLocation('plant');
      const doc = await draft(location.id, [chicken()]);
      expect(doc).toMatchObject({
        type: 'opening_balance',
        status: 'draft',
        businessDate: today,
        revision: 1,
        postedAt: null,
        location: { id: location.id, code: location.code },
        lines: [
          {
            lineNo: 1,
            item: { code: 'WHOLE-CHICKEN', baseUnitCode: 'kg', variableWeight: true },
            quantity: '21.600',
            secondaryQuantity: '12',
            unitCost: '72.5',
            value: '1566',
            lot: null,
          },
        ],
        totalValue: '1566',
      });
      expect(doc.number).toMatch(DOCUMENT_NUMBER);
      expect((await stock({ locationId: location.id })).rows).toEqual([]);

      const edited = await as(plant).patch(`/opening-balances/${doc.id}`, {
        revision: 1,
        businessDate: addDays(today, -1),
        note: '  Counted on the first morning  ',
        lines: [chicken(), flour()],
      });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({
        revision: 2,
        businessDate: addDays(today, -1),
        note: 'Counted on the first morning',
        totalValue: '9691',
      });
      expect(edited.body.lines).toHaveLength(2);

      const stale = await as(plant).patch(`/opening-balances/${doc.id}`, {
        revision: 1,
        note: 'x',
      });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({
        code: 'DOCUMENT_CHANGED',
        details: { currentRevision: 2 },
      });
    });

    it('take numbers with no gaps, even when created together', async () => {
      const location = await newLocation('warehouse');
      const created = await Promise.all(
        Array.from({ length: 5 }, () =>
          as(plant).post('/opening-balances', { locationId: location.id, lines: [] }),
        ),
      );
      expect(created.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const serials = created
        .map((r) => Number((r.body.number as string).split('-')[2]))
        .sort((a, b) => a - b);
      expect(serials).toEqual([0, 1, 2, 3, 4].map((i) => serials[0] + i));
    });

    it('refuse what cannot be an opening balance, saying why', async () => {
      const location = await newLocation('plant');
      const inactive = await newLocation('branch');
      await as(admin).patch(`/locations/${inactive.id}`, {
        revision: inactive.revision,
        active: false,
      });

      const cases: Array<[Body, number, Body]> = [
        [
          { locationId: location.inTransit.id, lines: [] },
          422,
          { code: 'LOCATION_NOT_ALLOWED', details: { problem: 'LOCATION_SYSTEM_MANAGED' } },
        ],
        [
          { locationId: inactive.id, lines: [] },
          422,
          { code: 'LOCATION_NOT_ALLOWED', details: { problem: 'LOCATION_INACTIVE' } },
        ],
        [
          { locationId: '00000000-0000-4000-8000-000000000000', lines: [] },
          422,
          { code: 'UNKNOWN_LOCATION' },
        ],
        [
          { locationId: location.id, lines: [flour(), drumsticks({ quantity: '2.5' })] },
          422,
          {
            code: 'INVALID_OPENING_BALANCE_LINE',
            details: { lineNo: 2, problem: 'QUANTITY_TOO_PRECISE' },
          },
        ],
        [
          { locationId: location.id, lines: [flour({ secondaryQuantity: '10' })] },
          422,
          { details: { lineNo: 1, problem: 'SECONDARY_QUANTITY_NOT_ALLOWED' } },
        ],
        [
          { locationId: location.id, lines: [flour({ unitCost: '-1' })] },
          422,
          { details: { lineNo: 1, problem: 'UNIT_COST_NEGATIVE' } },
        ],
        [
          { locationId: location.id, lines: [flour({ expiryDate: '2026-02-30' })] },
          422,
          { details: { lineNo: 1, problem: 'EXPIRY_NOT_A_DATE' } },
        ],
        [
          {
            locationId: location.id,
            lines: [chicken({ itemId: '00000000-0000-4000-8000-000000000000' })],
          },
          422,
          { code: 'UNKNOWN_ITEM', details: { lineNo: 1 } },
        ],
        [
          { locationId: location.id, businessDate: addDays(today, 1), lines: [] },
          422,
          { code: 'BUSINESS_DATE_IN_FUTURE' },
        ],
        [{ locationId: location.id, lines: [flour({ quantity: 250 })] }, 400, {}],
      ];
      for (const [body, status, error] of cases) {
        const res = await as(plant).post('/opening-balances', body);
        expect({ status: res.status, body: res.body }).toMatchObject({ status, body: error });
      }
    });

    it('are drafted, posted and reversed by the plant role only; anyone signed in reads', async () => {
      const location = await newLocation('plant');
      expect(
        (await as(finance).post('/opening-balances', { locationId: location.id, lines: [] }))
          .status,
      ).toBe(403);
      expect(
        (await as(admin).post('/opening-balances', { locationId: location.id, lines: [] })).status,
      ).toBe(403);
      const doc = await draft(location.id, [flour()]);
      expect(
        (await as(finance).post(`/opening-balances/${doc.id}/post`, { revision: 1 })).status,
      ).toBe(403);
      expect((await as(finance).get(`/opening-balances/${doc.id}`)).status).toBe(200);
      expect((await as(finance).get('/opening-balances')).status).toBe(200);
      expect((await as(null).get('/stock-on-hand')).status).toBe(401);
      expect((await as(null).get('/opening-balances')).status).toBe(401);
    });
  });

  describe('posting', () => {
    it('turns every line into a lot, with its ledger entries and balances, in one go', async () => {
      const location = await newLocation('plant');
      const doc = await draft(location.id, [chicken(), flour()], {
        businessDate: addDays(today, -2),
      });
      const succeededBefore = await postings({
        document_type: 'opening_balance',
        outcome: 'succeeded',
      });
      const requestId = unique('post').toLowerCase();

      const res = await post(doc, requestId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'posted',
        revision: 2,
        postedBy: { id: plant.user.id, displayName: 'Demo plant' },
        lines: [{ lot: { number: `${doc.number}/1` } }, { lot: { number: `${doc.number}/2` } }],
      });

      // Business time is the start of the business date in Bangkok; posting time is now.
      const entries = await entriesOf(doc.id);
      expect(entries.map((e) => [e.quantity, e.secondaryQuantity, e.unitCost])).toEqual([
        ['21.600', '12', '72.500000'],
        ['250.000', null, '32.500000'],
      ]);
      const [{ start }] = await prisma.$queryRaw<{ start: Date }[]>`
        SELECT (${addDays(today, -2)}::date::timestamp AT TIME ZONE 'Asia/Bangkok') AS "start"
      `;
      for (const entry of entries) {
        expect(entry.businessTime).toEqual(start);
        expect(Date.now() - (entry.postedAt as Date).getTime()).toBeLessThan(60_000);
        expect(entry.postedById).toBe(plant.user.id);
      }

      const onHand = await stock({ locationId: location.id });
      expect(onHand).toMatchObject({
        asOf: today,
        totalValue: '9691',
        rows: [
          {
            item: { code: 'FLOUR' },
            lot: { number: `${doc.number}/2`, expiryDate: addDays(today, 150) },
            location: { code: location.code, type: 'plant' },
            quantity: '250.000',
            secondaryQuantity: null,
            unitCost: '32.5',
            value: '8125',
            expired: false,
          },
          {
            item: { code: 'WHOLE-CHICKEN' },
            quantity: '21.600',
            secondaryQuantity: '12',
            unitCost: '72.5',
            value: '1566',
          },
        ],
      });

      expect((await as(finance).get(`/locations/${location.id}`)).body.firstUse).toBe(
        `posted document ${doc.number}`,
      );
      const [line] = linesOf('ledger.posting.succeeded', doc.number);
      expect(line).toMatchObject({
        severity: 'INFO',
        labels: { correlation_id: requestId, location_code: location.code },
      });
      expect(await postings({ document_type: 'opening_balance', outcome: 'succeeded' })).toBe(
        succeededBefore + 1,
      );
    });

    it('never edits or posts a posted document again', async () => {
      const location = await newLocation('plant');
      const doc = await posted(location.id, [flour()]);

      const edit = await as(plant).patch(`/opening-balances/${doc.id}`, {
        revision: doc.revision,
        note: 'changed my mind',
      });
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe('DOCUMENT_POSTED');

      const again = await post(doc);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: 'POSTING_REFUSED',
        details: { rule: 'already_posted' },
      });
      expect(await entriesOf(doc.id)).toHaveLength(1);
    });

    it('refuses by rule, writes nothing, and logs and counts the rule', async () => {
      const location = await newLocation('plant');
      const newItem = await as(admin).post('/items', {
        code: unique('SAUCE'),
        nameTh: 'ซอสทดสอบ',
        nameEn: 'Test sauce',
        baseUnitCode: 'l',
        variableWeight: false,
        shelfLifeDays: 30,
        purchaseUnits: [],
      });
      expect(newItem.status).toBe(201);

      const empty = await draft(location.id, []);
      const expired = await draft(
        location.id,
        [flour(), chicken({ expiryDate: addDays(today, -2) })],
        {
          businessDate: addDays(today, -1),
        },
      );
      const withSauce = await draft(location.id, [
        { itemId: newItem.body.id, quantity: '5', unitCost: '40', expiryDate: addDays(today, 30) },
      ]);
      const deactivated = await as(admin).patch(`/items/${newItem.body.id}`, {
        version: newItem.body.version,
        active: false,
      });
      expect(deactivated.status).toBe(200);

      const cases: Array<[Body, number, Body]> = [
        [empty, 422, { rule: 'empty_document' }],
        [expired, 422, { rule: 'expired_lot', lineNo: 2 }],
        [withSauce, 422, { rule: 'inactive_item', lineNo: 1 }],
        [{ ...empty, revision: 7 }, 409, { rule: 'stale_revision', currentRevision: 1 }],
      ];
      for (const [doc, status, details] of cases) {
        const before = await postings({
          document_type: 'opening_balance',
          outcome: 'refused',
          rule: details.rule,
        });
        const res = await post(doc);
        expect({ status: res.status, body: res.body }).toMatchObject({
          status,
          body: { code: 'POSTING_REFUSED', details },
        });
        const refused = linesOf('ledger.posting.refused', doc.number);
        expect(refused.at(-1)).toMatchObject({
          severity: 'WARNING',
          labels: { rule: details.rule, location_code: location.code },
        });
        expect(
          await postings({
            document_type: 'opening_balance',
            outcome: 'refused',
            rule: details.rule,
          }),
        ).toBe(before + 1);
        expect(await entriesOf(doc.id)).toEqual([]);
      }
      expect((await stock({ locationId: location.id })).rows).toEqual([]);
      expect(await prisma.lot.count({ where: { originDocumentId: expired.id } })).toBe(0);
    });

    it('posts a draft once when two people post it at the same moment', async () => {
      const location = await newLocation('plant');
      const doc = await draft(location.id, [chicken(), flour()]);
      const results = await Promise.all([post(doc), post(doc), post(doc)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await entriesOf(doc.id)).toHaveLength(2);
    });
  });

  describe('the ledger itself', () => {
    it('refuses, in the database, to update or delete an entry, a lot or a posted document', async () => {
      const location = await newLocation('plant');
      const doc = await posted(location.id, [flour()]);
      const [entry] = await entriesOf(doc.id);

      await expect(
        prisma.$executeRaw`UPDATE "ledger_entries" SET "quantity" = 1 WHERE "id" = ${entry.id}::uuid`,
      ).rejects.toThrow(/ledger_entries is append-only \(attempted UPDATE\)/);
      await expect(
        prisma.$executeRaw`DELETE FROM "ledger_entries" WHERE "id" = ${entry.id}::uuid`,
      ).rejects.toThrow(/ledger_entries is append-only \(attempted DELETE\)/);
      await expect(
        prisma.$executeRaw`UPDATE "lots" SET "unit_cost" = 0 WHERE "id" = ${entry.lotId}::uuid`,
      ).rejects.toThrow(/lots is append-only/);
      await expect(
        prisma.$executeRaw`UPDATE "stock_documents" SET "note" = 'edited' WHERE "id" = ${doc.id}::uuid`,
      ).rejects.toThrow(/a posted document never changes/);
      await expect(
        prisma.$executeRaw`DELETE FROM "stock_documents" WHERE "id" = ${doc.id}::uuid`,
      ).rejects.toThrow(/documents are never deleted/);
      await expect(
        prisma.$executeRaw`UPDATE "opening_balance_lines" SET "quantity" = 1 WHERE "document_id" = ${doc.id}::uuid`,
      ).rejects.toThrow(/fixed once the document is posted/);

      expect((await entriesOf(doc.id))[0]).toMatchObject({ quantity: '250.000' });
    });
  });

  describe('reversal', () => {
    it('negates a posted document exactly, and both stay visible', async () => {
      const location = await newLocation('plant');
      const doc = await posted(location.id, [chicken(), flour()], {
        businessDate: addDays(today, -2),
      });

      const res = await reverse(doc.id, { note: 'Counted twice' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: doc.id,
        status: 'posted',
        reversedBy: {
          businessDate: today,
          note: 'Counted twice',
          postedBy: { id: plant.user.id },
        },
      });
      const reversal = res.body.reversedBy;
      expect(reversal.number).toMatch(REVERSAL_NUMBER);

      const original = await entriesOf(doc.id);
      const negated = await entriesOf(reversal.id);
      expect(negated).toHaveLength(original.length);
      negated.forEach((entry, i) => {
        expect(entry).toMatchObject({
          lotId: original[i].lotId,
          locationId: original[i].locationId,
          unitCost: original[i].unitCost,
          reversesEntryId: original[i].id,
        });
        expect(Number(entry.quantity)).toBe(-Number(original[i].quantity));
      });
      expect(negated.map((e) => e.secondaryQuantity)).toEqual(['-12', null]);

      // Today nothing is left; yesterday, before the reversal's business date, it all was.
      expect((await stock({ locationId: location.id })).rows).toEqual([]);
      expect((await stock({ locationId: location.id, asOf: addDays(today, -1) })).totalValue).toBe(
        '9691',
      );
      const list = (await as(finance).get('/opening-balances').query({ locationId: location.id }))
        .body as Body[];
      expect(list[0]).toMatchObject({
        number: doc.number,
        reversedBy: { number: reversal.number },
      });
      expect(linesOf('ledger.posting.succeeded', reversal.number)).toHaveLength(1);
    });

    it('happens once, never to a draft or a reversal, and never before the original', async () => {
      const location = await newLocation('plant');
      const doc = await posted(location.id, [flour()], { businessDate: addDays(today, -1) });

      const early = await reverse(doc.id, { businessDate: addDays(today, -2) });
      expect(early.status).toBe(422);
      expect(early.body.details.rule).toBe('business_date_before_original');
      const future = await reverse(doc.id, { businessDate: addDays(today, 1) });
      expect(future.body.details.rule).toBe('business_date_in_future');

      const first = await reverse(doc.id, { businessDate: addDays(today, -1) });
      expect(first.status).toBe(200);
      const second = await reverse(doc.id);
      expect(second.status).toBe(409);
      expect(second.body.details.rule).toBe('already_reversed');

      const unposted = await draft(location.id, [flour()]);
      const notPosted = await reverse(unposted.id);
      expect(notPosted.status).toBe(422);
      expect(notPosted.body.details.rule).toBe('not_posted');

      await expect(
        ledger.reverse(
          first.body.reversedBy.id,
          { note: null },
          {
            userId: plant.user.id,
            email: plant.user.email,
            displayName: 'Demo plant',
            roles: ['plant'],
            permissions: [],
            sessionId: 'e2e',
          },
        ),
      ).rejects.toMatchObject({ rule: 'reversal_of_reversal' });
      expect((await as(finance).get(`/opening-balances/${first.body.reversedBy.id}`)).status).toBe(
        404,
      );
    });

    it('two reversals of the same document at the same moment make exactly one', async () => {
      const location = await newLocation('plant');
      const doc = await posted(location.id, [chicken(), flour()]);

      const results = await Promise.all(Array.from({ length: 4 }, () => reverse(doc.id)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
      for (const refused of results.filter((r) => r.status === 409)) {
        expect(refused.body.details.rule).toBe('already_reversed');
      }
      const reversals = await prisma.stockDocument.findMany({ where: { reversesId: doc.id } });
      expect(reversals).toHaveLength(1);
      expect(await entriesOf(reversals[0].id)).toHaveLength(2);
      expect((await stock({ locationId: location.id })).rows).toEqual([]);
    });

    it('never takes plant stock below zero, lets a branch go negative, and leaves no gap in numbers', async () => {
      const plantSite = await newLocation('plant');
      const branch = await newLocation('branch');
      const atPlant = await posted(plantSite.id, [chicken()]);
      const atBranch = await posted(branch.id, [chicken()]);
      await consume(atPlant.lines[0].lot.id, plantSite.id, '5');
      await consume(atBranch.lines[0].lot.id, branch.id, '5');

      const lastNumber = async () =>
        (await prisma.stockDocument.findFirst({
          where: { type: 'reversal' },
          orderBy: { number: 'desc' },
        }))!.number;
      const before = await lastNumber();

      const refused = await reverse(atPlant.id);
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({
        code: 'POSTING_REFUSED',
        details: { rule: 'negative_stock_plant', locationCode: plantSite.code, quantity: '-5' },
      });
      expect(await prisma.stockDocument.count({ where: { reversesId: atPlant.id } })).toBe(0);
      expect((await stock({ locationId: plantSite.id })).rows[0].quantity).toBe('16.600');

      const allowed = await reverse(atBranch.id);
      expect(allowed.status).toBe(200);
      const serial = (n: string) => Number(n.split('-')[2]);
      expect(serial(allowed.body.reversedBy.number)).toBe(serial(before) + 1);
      expect((await stock({ locationId: branch.id })).rows).toMatchObject([
        { location: { type: 'branch' }, quantity: '-5.000', value: '-362.5' },
      ]);
    });
  });

  describe('stock on hand', () => {
    it('answers as of any date by business time, flagging lots already expired', async () => {
      const branch = await newLocation('branch');
      const doc = await posted(
        branch.id,
        [drumsticks({ expiryDate: addDays(today, -2) }), chicken()],
        { businessDate: addDays(today, -3) },
      );

      expect((await stock({ locationId: branch.id, asOf: addDays(today, -4) })).rows).toEqual([]);
      const onTheDay = await stock({ locationId: branch.id, asOf: addDays(today, -3) });
      expect(onTheDay).toMatchObject({
        asOf: addDays(today, -3),
        totalValue: '1696',
        rows: [
          { item: { code: 'CHICKEN-DRUMSTICK' }, quantity: '40', value: '130', expired: false },
          { item: { code: 'WHOLE-CHICKEN' }, quantity: '21.600', expired: false },
        ],
      });
      const later = await stock({ locationId: branch.id, asOf: addDays(today, -1) });
      expect(later.rows.map((r: Body) => r.expired)).toEqual([true, false]);
      expect((await stock({ locationId: branch.id })).rows).toHaveLength(2);

      const onlyChicken = await stock({ locationId: branch.id, itemId: items['WHOLE-CHICKEN'].id });
      expect(onlyChicken.rows.map((r: Body) => r.lot.number)).toEqual([`${doc.number}/2`]);
    });

    it('is refused for a date still to come, or one that is not a date', async () => {
      const future = await as(finance)
        .get('/stock-on-hand')
        .query({ asOf: addDays(today, 1) });
      expect(future.status).toBe(422);
      expect(future.body.code).toBe('AS_OF_IN_FUTURE');
      const invalid = await as(finance).get('/stock-on-hand').query({ asOf: '2026-02-30' });
      expect(invalid.status).toBe(422);
      expect(invalid.body.code).toBe('INVALID_DATE');
      expect((await as(finance).get('/stock-on-hand').query({ asOf: 'yesterday' })).status).toBe(
        400,
      );
    });
  });

  describe('the balance snapshot', () => {
    type Row = { lotId: string; locationId: string; quantity: string; secondary: string | null };
    const snapshot = () =>
      prisma.$queryRaw<Row[]>`
        SELECT "lot_id" AS "lotId", "location_id" AS "locationId", "quantity"::text AS "quantity",
               "secondary_quantity"::text AS "secondary"
        FROM "stock_balances" ORDER BY "lot_id", "location_id"
      `;

    it('rebuilt from the ledger equals the snapshot every posting kept up to date', async () => {
      const location = await newLocation('plant');
      const doc = await posted(location.id, [
        chicken(),
        flour(),
        chicken({ quantity: '1.8', secondaryQuantity: '1' }),
      ]);
      await reverse(doc.id);
      await posted(location.id, [chicken({ quantity: '43.2', secondaryQuantity: '24' })]);

      expect(await ledger.compareBalances()).toEqual([]);
      const before = await snapshot();
      expect(before.length).toBeGreaterThan(0);
      expect(await ledger.rebuildBalances()).toEqual({ balances: before.length, corrected: 0 });
      expect(await snapshot()).toEqual(before);
    });

    it('is corrected by a rebuild when it disagrees: the ledger wins', async () => {
      const location = await newLocation('plant');
      const doc = await posted(location.id, [flour()]);
      const lotId = doc.lines[0].lot.id;
      await prisma.$executeRaw`
        UPDATE "stock_balances" SET "quantity" = "quantity" + 1
        WHERE "lot_id" = ${lotId}::uuid AND "location_id" = ${location.id}::uuid
      `;

      expect(await ledger.compareBalances()).toEqual([
        {
          lotId,
          locationId: location.id,
          snapshot: { quantity: '251.000', secondaryQuantity: null },
          ledger: { quantity: '250.000', secondaryQuantity: null },
        },
      ]);
      expect((await ledger.rebuildBalances()).corrected).toBe(1);
      expect(await ledger.compareBalances()).toEqual([]);
      expect((await stock({ locationId: location.id })).rows[0].quantity).toBe('250.000');
    });
  });
});

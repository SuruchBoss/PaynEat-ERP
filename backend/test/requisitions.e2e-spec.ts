// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Branch requisitions and par levels (#15), end to end against a real PostgreSQL: the demo
 * requisitions and the transfers created from them, the suggestion through the API (a negative
 * branch balance, stock already on the road, whole requisition units), the requisition's steps and
 * what refuses them, fulfilment by several transfers that follows what they dispatched, the
 * cancellation rules, two people preparing transfers at once, the database's own guards, the
 * par-miss report, who may do what, and the logs and audit trail.
 */
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { addDays } from 'src/core/time/domain/business-date';
import { DEMO_PAR_LEVELS, DEMO_TRANSFERS } from '../prisma/demo-data';
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

describe('requisitions (#15)', () => {
  let ctx: TestContext;
  let admin: Session;
  let plant: Session;
  let logistics: Session;
  let manager: Session;
  let finance: Session;
  let prisma: PrismaService;
  let today: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    admin = await signInAsAdmin(ctx.server);
    plant = await signIn(ctx.server, demoEmail('plant'));
    logistics = await signIn(ctx.server, demoEmail('logistics'));
    manager = await signIn(ctx.server, demoEmail('branch_manager'));
    finance = await signIn(ctx.server, demoEmail('finance'));
    today = (await as(finance).get('/stock-on-hand')).body.asOf;
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
      delete: (path: string) => auth(request(ctx.server).delete(`${API}${path}`)),
    };
  };

  const ok = (res: request.Response, status = 200): Body => {
    if (res.status !== status) {
      throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  };

  const newLocation = async (type: 'plant' | 'branch' | 'warehouse'): Promise<Body> =>
    ok(
      await as(admin).post('/locations', {
        code: unique(type === 'plant' ? 'PL' : type === 'branch' ? 'BR' : 'WH'),
        type,
        nameTh: 'ทดสอบ',
        nameEn: 'Test',
      }),
      201,
    );

  /** A new item counted in pieces, sent in trays of `tray` when given. */
  const newItem = async (tray: string | null = null): Promise<Body> => {
    const item = ok(
      await as(admin).post('/items', {
        code: unique('RQ'),
        nameTh: 'ไก่ทดสอบ',
        nameEn: 'Test chicken piece',
        baseUnitCode: 'piece',
        variableWeight: false,
        shelfLifeDays: 3,
        purchaseUnits: [],
      }),
      201,
    );
    if (tray === null) return item;
    return ok(await as(admin).put(`/items/${item.id}/requisition-unit`, { requisitionUnit: tray }));
  };

  /** Stock brought into a location by an opening balance dated `daysAgo` days before today. */
  const stockAt = async (
    locationId: string,
    itemId: string,
    quantity: string,
    daysAgo = 1,
  ): Promise<Body> => {
    const draft = ok(
      await as(plant).post('/opening-balances', {
        locationId,
        businessDate: addDays(today, -daysAgo),
        lines: [
          {
            itemId,
            quantity,
            secondaryQuantity: null,
            unitCost: '20',
            expiryDate: addDays(today, 3),
          },
        ],
      }),
      201,
    );
    return ok(
      await as(plant).post(`/opening-balances/${draft.id}/post`, { revision: draft.revision }),
    );
  };

  /**
   * Takes stock out of a branch as a sale would, on a business date `daysAgo` days before today,
   * without asking whether there is any (a branch may go below zero, ADR-0003).
   */
  const sell = async (lotId: string, locationId: string, quantity: string, daysAgo = 0) => {
    const date = addDays(today, -daysAgo);
    counter += 1;
    const number = `TS-${today.slice(0, 4)}-${String(Date.now()).slice(-7)}${counter}`;
    await prisma.$transaction(async (tx) => {
      const [doc] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "stock_documents" ("id", "number", "type", "status", "business_date",
          "revision", "created_by_id", "posted_by_id", "posted_at", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${number}, 'opening_balance', 'posted', ${date}::date, 1,
          ${plant.user.id}::uuid, ${plant.user.id}::uuid, now(), now(), now())
        RETURNING "id"
      `;
      await tx.$executeRaw`
        INSERT INTO "ledger_entries" ("id", "document_id", "line_no", "item_id", "lot_id",
          "location_id", "quantity", "unit_cost", "business_time", "posted_by_id", "posted_at")
        SELECT gen_random_uuid(), ${doc.id}::uuid, 1, "item_id", "id", ${locationId}::uuid,
          -${quantity}::numeric, "unit_cost", (${date}::date + interval '12 hours') AT TIME ZONE 'UTC',
          ${plant.user.id}::uuid, now()
        FROM "lots" WHERE "id" = ${lotId}::uuid
      `;
      await tx.$executeRaw`
        INSERT INTO "stock_balances" ("lot_id", "item_id", "location_id", "quantity", "updated_at")
        SELECT "id", "item_id", ${locationId}::uuid, -${quantity}::numeric, now()
        FROM "lots" WHERE "id" = ${lotId}::uuid
        ON CONFLICT ("lot_id", "location_id")
        DO UPDATE SET "quantity" = "stock_balances"."quantity" - ${quantity}::numeric
      `;
    });
  };

  const setPar = (branchId: string, itemId: string, quantity: string, by: Session = admin) =>
    as(by).put(`/par-levels/${branchId}/${itemId}`, { quantity });

  /** Drafts a requisition for `at.branch`, supplied by `at.origin`, needed today. */
  const raise = (
    at: { branch: Body; origin: Body },
    lines: Array<[string, string]>,
    extra: Body = {},
  ) =>
    as(manager).post('/requisitions', {
      branchId: at.branch.id,
      supplyingLocationId: at.origin.id,
      neededBy: today,
      lines: lines.map(([itemId, requested]) => ({ itemId, requested })),
      ...extra,
    });

  const submit = async (requisition: Body): Promise<Body> =>
    ok(
      await as(manager).post(`/requisitions/${requisition.id}/submit`, {
        revision: requisition.revision,
      }),
    );

  const fresh = async (id: string): Promise<Body> =>
    ok(await as(finance).get(`/requisitions/${id}`));

  const transferFrom = (requisition: Body, extra: Body = {}) =>
    as(logistics).post(`/requisitions/${requisition.id}/transfers`, {
      revision: requisition.revision,
      ...extra,
    });

  const dispatch = async (transfer: Body): Promise<Body> =>
    ok(
      await as(logistics).post(`/transfers/${transfer.id}/dispatch`, {
        revision: transfer.revision,
        picks: transfer.lines.flatMap((l: Body) =>
          l.picks.map((p: Body) => ({
            lineNo: l.lineNo,
            lotId: p.lotId,
            quantity: p.quantity,
            pieces: p.pieces,
          })),
        ),
      }),
    );

  /** A plant holding 200 of a new item sent in trays of ten, and a branch with a par level of 40. */
  const scene = async () => {
    const origin = await newLocation('plant');
    const branch = await newLocation('branch');
    const item = await newItem('10');
    await stockAt(origin.id, item.id, '200');
    ok(await setPar(branch.id, item.id, '40'));
    return { origin, branch, item };
  };

  /** A submitted requisition from `scene` for `requested` of its item. */
  const submitted = async (s: Awaited<ReturnType<typeof scene>>, requested = '40') =>
    submit(ok(await raise(s, [[s.item.id, requested]]), 201));

  describe('the demo seed', () => {
    it('raises one requisition per branch and creates each demo transfer from it', async () => {
      const list = (ok(await as(finance).get('/requisitions')) as Body[]).filter((r) =>
        DEMO_TRANSFERS.some((t) => t.destinationCode === r.branch.code),
      );
      const byBranch = new Map(list.map((r) => [r.branch.code, r]));
      expect([...byBranch.keys()].sort()).toEqual(
        DEMO_TRANSFERS.map((t) => t.destinationCode).sort(),
      );
      expect(byBranch.get('BR-SILOM')!.status).toBe('fulfilled');
      expect(byBranch.get('BR-ARI')!.status).toBe('fulfilled');
      // Bang Na asked for 40 drumsticks and got 30: still in logistics' queue.
      const bangNa = await fresh(byBranch.get('BR-BANGNA')!.id);
      expect(bangNa.status).toBe('partially_fulfilled');
      expect(bangNa.lines.find((l: Body) => l.item.code === 'CHICKEN-DRUMSTICK')).toMatchObject({
        requested: '40',
        dispatched: '30',
        drafted: '0',
        outstanding: '10',
      });
      expect(bangNa.transfers).toHaveLength(1);
      const transfer = ok(await as(finance).get(`/transfers/${bangNa.transfers[0].id}`));
      expect(transfer).toMatchObject({ requisitionId: bangNa.id, status: 'received' });

      const queue = ok(await as(logistics).get('/requisitions').query({ status: 'open' }));
      expect(queue.map((r: Body) => r.id)).toContain(bangNa.id);
      expect(queue.map((r: Body) => r.id)).not.toContain(byBranch.get('BR-SILOM')!.id);
    });

    it('sets par levels for the three branches and trays of ten for the chicken pieces', async () => {
      const pars = ok(await as(finance).get('/par-levels')) as Body[];
      for (const [branch, levels] of Object.entries(DEMO_PAR_LEVELS)) {
        for (const [code, quantity] of Object.entries(levels)) {
          expect(
            pars.find((p) => p.location.code === branch && p.item.code === code)?.quantity,
          ).toBe(quantity);
        }
      }
      const items = ok(await as(finance).get('/items')) as Body[];
      expect(items.find((i) => i.code === 'CHICKEN-WING')!.requisitionUnit).toBe('10');
    });
  });

  describe('the suggestion through the API', () => {
    it('is par less the branch balance less what is on the road, in whole trays', async () => {
      const s = await scene();
      // 12 at the branch, 10 dispatched to it and not yet received: 40 − 12 − 10 = 18 → 2 trays.
      await stockAt(s.branch.id, s.item.id, '12');
      const transfer = ok(
        await as(logistics).post('/transfers', {
          originId: s.origin.id,
          destinationId: s.branch.id,
          lines: [{ itemId: s.item.id, quantity: '10' }],
        }),
        201,
      );
      await dispatch(transfer);

      const view = ok(
        await as(manager).get('/requisitions/suggestions').query({ branchId: s.branch.id }),
      );
      expect(view.items).toEqual([
        expect.objectContaining({
          item: expect.objectContaining({ id: s.item.id, requisitionUnit: '10' }),
          par: '40',
          balance: '12',
          inTransit: '10',
          suggested: '20',
        }),
      ]);

      // The line remembers what was suggested when it was saved; the person asks for their own.
      const raised = ok(await raise(s, [[s.item.id, '30']]), 201);
      expect(raised.lines[0]).toMatchObject({ suggested: '20', requested: '30' });
    });

    it('asks for more when the branch has sold what the ledger has not seen arrive', async () => {
      const s = await scene();
      const posted = await stockAt(s.branch.id, s.item.id, '4');
      await sell(posted.lines[0].lot.id, s.branch.id, '10');
      const view = ok(
        await as(manager).get('/requisitions/suggestions').query({ branchId: s.branch.id }),
      );
      // 40 − (−6) − 0 = 46 → five trays.
      expect(view.items[0]).toMatchObject({ balance: '-6', inTransit: '0', suggested: '50' });
    });

    it('suggests nothing for an item without a par level, which can still be requested', async () => {
      const s = await scene();
      const other = await newItem();
      const raised = ok(await raise(s, [[other.id, '7']]), 201);
      expect(raised.lines[0]).toMatchObject({ suggested: null, requested: '7' });
      const view = ok(
        await as(manager).get('/requisitions/suggestions').query({ branchId: s.branch.id }),
      );
      expect(view.items.map((i: Body) => i.item.id)).toEqual([s.item.id]);
    });
  });

  describe('a requisition', () => {
    it('is drafted, edited and submitted by the branch', async () => {
      const s = await scene();
      const draft = ok(await raise(s, [[s.item.id, '30']]), 201);
      expect(draft).toMatchObject({
        status: 'draft',
        number: expect.stringMatching(/^RQ-\d{4}-\d{5}$/),
        branch: { id: s.branch.id },
        supplyingLocation: { id: s.origin.id },
        neededBy: today,
      });
      const edited = ok(
        await as(manager).patch(`/requisitions/${draft.id}`, {
          revision: draft.revision,
          lines: [{ itemId: s.item.id, requested: '40' }],
          note: 'For the weekend',
        }),
      );
      expect(edited).toMatchObject({ revision: draft.revision + 1, note: 'For the weekend' });
      const done = await submit(edited);
      expect(done).toMatchObject({
        status: 'submitted',
        submitted: { by: { id: manager.user.id } },
      });

      // Edited only as a draft; a stale revision is refused.
      const late = await as(manager).patch(`/requisitions/${done.id}`, {
        revision: done.revision,
        note: 'x',
      });
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('STEP_NOT_ALLOWED');
      const stale = await as(manager).post(`/requisitions/${done.id}/cancel`, {
        revision: draft.revision,
        reason: 'x',
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('REQUISITION_CHANGED');
    });

    it('refuses what the plant cannot send: part of a tray, a repeated item, a past date, nothing at all', async () => {
      const s = await scene();
      const notATray = await raise(s, [[s.item.id, '25']]);
      expect(notATray.status).toBe(422);
      expect(notATray.body).toMatchObject({
        code: 'INVALID_REQUISITION_LINE',
        details: { problem: 'NOT_A_MULTIPLE', requisitionUnit: '10' },
      });
      const twice = await raise(s, [
        [s.item.id, '10'],
        [s.item.id, '20'],
      ]);
      expect(twice.body.details.problem).toBe('DUPLICATE_ITEM');
      const past = await raise(s, [[s.item.id, '10']], { neededBy: addDays(today, -1) });
      expect(past.body.code).toBe('NEEDED_BY_PASSED');
      // Named, unless the company has exactly one plant: this database has many.
      const unnamed = await raise(s, [[s.item.id, '10']], { supplyingLocationId: undefined });
      expect(unnamed.body.code).toBe('SUPPLYING_LOCATION_REQUIRED');
      const empty = ok(await raise(s, []), 201);
      const refused = await as(manager).post(`/requisitions/${empty.id}/submit`, {
        revision: empty.revision,
      });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('EMPTY_REQUISITION');
    });

    it('is raised only for a branch, and its transfers go only to that branch (#71 adds who may raise for which)', async () => {
      const s = await scene();
      const atPlant = await raise({ branch: s.origin, origin: s.origin }, [[s.item.id, '10']]);
      expect(atPlant.status).toBe(422);
      expect(atPlant.body.code).toBe('NOT_A_BRANCH');

      const requisition = await submitted(s);
      const transfer = ok(await transferFrom(requisition), 201);
      expect(transfer).toMatchObject({
        requisitionId: requisition.id,
        origin: { id: s.origin.id },
        destination: { id: s.branch.id },
      });
      const elsewhere = await newLocation('branch');
      const rerouted = await as(logistics).patch(`/transfers/${transfer.id}`, {
        revision: transfer.revision,
        destinationId: elsewhere.id,
      });
      expect(rerouted.status).toBe(422);
      expect(rerouted.body.code).toBe('ROUTE_SET_BY_REQUISITION');
    });
  });

  describe('fulfilment', () => {
    it('follows what transfers dispatched: partially, then fully, and back when a dispatch is reversed', async () => {
      const s = await scene();
      const requisition = await submitted(s, '40');

      // Logistics sends 30 first: a draft plans, it fulfils nothing.
      const first = ok(
        await transferFrom(requisition, { lines: [{ itemId: s.item.id, quantity: '30' }] }),
        201,
      );
      let now = await fresh(requisition.id);
      expect(now).toMatchObject({ status: 'submitted' });
      expect(now.lines[0]).toMatchObject({ dispatched: '0', drafted: '30', outstanding: '10' });

      await dispatch(first);
      now = await fresh(requisition.id);
      expect(now.status).toBe('partially_fulfilled');
      expect(now.lines[0]).toMatchObject({ dispatched: '30', drafted: '0', outstanding: '10' });

      // The second is prefilled with what is outstanding.
      const second = ok(await transferFrom(now), 201);
      expect(second.lines.map((l: Body) => l.quantity)).toEqual(['10']);
      now = await fresh(requisition.id);
      const nothing = await transferFrom(now);
      expect(nothing.status).toBe(422);
      expect(nothing.body.code).toBe('NOTHING_OUTSTANDING');

      const dispatched = await dispatch(second);
      now = await fresh(requisition.id);
      expect(now.status).toBe('fulfilled');
      expect(now.transfers.map((t: Body) => t.number)).toEqual([first.number, second.number]);
      const full = await transferFrom(now);
      expect(full.status).toBe(409);
      expect(full.body.code).toBe('STEP_NOT_ALLOWED');

      // A reversed dispatch moved nothing: the requisition is partly fulfilled again.
      ok(await as(logistics).post(`/transfers/${dispatched.id}/reverse`, {}));
      now = await fresh(requisition.id);
      expect(now.status).toBe('partially_fulfilled');
      expect(now.lines[0]).toMatchObject({ dispatched: '30', outstanding: '10' });
    });

    it('sends only items the requisition asks for', async () => {
      const s = await scene();
      const requisition = await submitted(s);
      const other = await newItem();
      const res = await transferFrom(requisition, { lines: [{ itemId: other.id, quantity: '1' }] });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ITEM_NOT_REQUESTED');
    });

    it('lets one of two people preparing a transfer at once go ahead; the other reloads', async () => {
      const s = await scene();
      const requisition = await submitted(s);
      const results = await Promise.all([transferFrom(requisition), transferFrom(requisition)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe('REQUISITION_CHANGED');
      const now = await fresh(requisition.id);
      expect(now.transfers).toHaveLength(1);
      expect(now.lines[0]).toMatchObject({ drafted: '40', outstanding: '0' });
    });
  });

  describe('cancellation', () => {
    it('cancels a draft or a submitted requisition with a reason, and never one with stock dispatched', async () => {
      const s = await scene();
      const draft = ok(await raise(s, [[s.item.id, '10']]), 201);
      const noReason = await as(manager).post(`/requisitions/${draft.id}/cancel`, {
        revision: draft.revision,
        reason: '  ',
      });
      expect(noReason.body.code).toBe('CANCELLATION_REASON_MISSING');
      const cancelled = ok(
        await as(manager).post(`/requisitions/${draft.id}/cancel`, {
          revision: draft.revision,
          reason: 'Raised twice',
        }),
      );
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelled: { reason: 'Raised twice' },
      });
      const afterwards = await transferFrom(cancelled);
      expect(afterwards.status).toBe(409);

      // A draft transfer of it is cancelled first, by logistics.
      const requisition = await submitted(s);
      const transfer = ok(await transferFrom(requisition), 201);
      let now = await fresh(requisition.id);
      const blocked = await as(manager).post(`/requisitions/${now.id}/cancel`, {
        revision: now.revision,
        reason: 'Not needed',
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body).toMatchObject({
        code: 'REQUISITION_HAS_DRAFT_TRANSFER',
        details: { transfer: transfer.number },
      });

      // Once stock is dispatched against it, it is not cancelled.
      await dispatch(transfer);
      now = await fresh(requisition.id);
      const refused = await as(manager).post(`/requisitions/${now.id}/cancel`, {
        revision: now.revision,
        reason: 'Not needed',
      });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('STEP_NOT_ALLOWED');

      // A reversed dispatch sent nothing, so it can be cancelled again.
      ok(await as(logistics).post(`/transfers/${transfer.id}/reverse`, {}));
      now = await fresh(requisition.id);
      ok(
        await as(manager).post(`/requisitions/${now.id}/cancel`, {
          revision: now.revision,
          reason: 'Sent from another branch instead',
        }),
      );
    });

    it('and a transfer being created at the same moment: exactly one wins', async () => {
      const s = await scene();
      const requisition = await submitted(s);
      const [cancel, transfer] = await Promise.all([
        as(manager).post(`/requisitions/${requisition.id}/cancel`, {
          revision: requisition.revision,
          reason: 'Race',
        }),
        transferFrom(requisition),
      ]);
      expect([cancel.status, transfer.status].filter((s2) => s2 < 300)).toHaveLength(1);
      const now = await fresh(requisition.id);
      expect(now.status === 'cancelled').toBe(now.transfers.length === 0);
    });
  });

  describe('the database', () => {
    it('never deletes a requisition, never moves a transfer off its requisition or route', async () => {
      const s = await scene();
      const requisition = await submitted(s);
      const transfer = ok(await transferFrom(requisition), 201);
      const other = await newLocation('branch');
      await expect(
        prisma.$executeRaw`DELETE FROM "requisitions" WHERE "id" = ${requisition.id}::uuid`,
      ).rejects.toThrow(/never deleted/);
      await expect(
        prisma.$executeRaw`UPDATE "transfers" SET "requisition_id" = NULL WHERE "document_id" = ${transfer.id}::uuid`,
      ).rejects.toThrow(/keeps the requisition/);
      await expect(
        prisma.$executeRaw`UPDATE "transfers" SET "destination_id" = ${other.id}::uuid WHERE "document_id" = ${transfer.id}::uuid`,
      ).rejects.toThrow(/supplying location to its branch/);
      await expect(
        prisma.$executeRaw`UPDATE "requisitions" SET "status" = 'cancelled', "cancelled_by_id" = ${manager.user.id}::uuid, "cancelled_at" = now(), "cancellation_reason" = 'x' WHERE "id" = ${requisition.id}::uuid`,
      ).rejects.toThrow(/is not cancelled/);
      await expect(
        prisma.$executeRaw`UPDATE "requisition_lines" SET "requested" = 50 WHERE "requisition_id" = ${requisition.id}::uuid`,
      ).rejects.toThrow(/only while it is a draft/);
    });
  });

  describe('par misses', () => {
    it('counts the times a branch went below zero and the lines not dispatched by their date', async () => {
      const s = await scene();
      // Twice below zero: 4 in three days ago, 6 sold two days ago (−2), 10 in yesterday (8),
      // 9 sold today (−1).
      const first = await stockAt(s.branch.id, s.item.id, '4', 3);
      await sell(first.lines[0].lot.id, s.branch.id, '6', 2);
      const second = await stockAt(s.branch.id, s.item.id, '10', 1);
      await sell(second.lines[0].lot.id, s.branch.id, '9', 0);

      // Two requisitions needed yesterday: one sent in full that day, one sent nothing.
      const past = async (requested: string): Promise<string> => {
        const row = await prisma.requisition.create({
          data: {
            number: unique('RQ-PAST'),
            branchId: s.branch.id,
            supplyingLocationId: s.origin.id,
            neededBy: new Date(`${addDays(today, -1)}T00:00:00Z`),
            createdById: manager.user.id,
            lines: { create: [{ lineNo: 1, itemId: s.item.id, requested }] },
          },
        });
        await prisma.requisition.update({
          where: { id: row.id },
          data: { status: 'submitted', submittedById: manager.user.id, submittedAt: new Date() },
        });
        return row.id;
      };
      const kept = await past('10');
      await past('20');
      const transfer = ok(
        await as(logistics).post(`/requisitions/${kept}/transfers`, {
          revision: (await fresh(kept)).revision,
          businessDate: addDays(today, -1),
        }),
        201,
      );
      await dispatch(transfer);

      const report = ok(
        await as(finance).get('/requisitions/par-misses').query({ branchId: s.branch.id }),
      );
      expect(report).toMatchObject({ to: today, from: addDays(today, -27) });
      expect(report.rows).toEqual([
        expect.objectContaining({
          branch: expect.objectContaining({ id: s.branch.id }),
          item: expect.objectContaining({ id: s.item.id }),
          par: '40',
          negativeEpisodes: 2,
          linesDue: 2,
          linesMissed: 1,
        }),
      ]);

      // A period ending three days ago sees neither; one ending two days ago sees the first dip.
      const query = (to: number) =>
        as(finance)
          .get('/requisitions/par-misses')
          .query({ branchId: s.branch.id, from: addDays(today, -10), to: addDays(today, -to) });
      expect(ok(await query(3)).rows[0]).toMatchObject({ negativeEpisodes: 0, linesDue: 0 });
      expect(ok(await query(2)).rows[0]).toMatchObject({ negativeEpisodes: 1, linesDue: 0 });
      const future = await as(finance)
        .get('/requisitions/par-misses')
        .query({ to: addDays(today, 1) });
      expect(future.body.code).toBe('PERIOD_IN_FUTURE');
    });
  });

  describe('configuration', () => {
    it('par levels and requisition units are the admin’s, checked and audited', async () => {
      const branch = await newLocation('branch');
      const item = await newItem();
      expect((await setPar(branch.id, item.id, '10', manager)).status).toBe(403);
      expect((await setPar(branch.id, item.id, '1.5')).body.code).toBe('INVALID_PAR_LEVEL');
      const atPlant = await newLocation('plant');
      expect((await setPar(atPlant.id, item.id, '10')).body.code).toBe('NOT_A_BRANCH');
      ok(await setPar(branch.id, item.id, '0'));
      ok(await setPar(branch.id, item.id, '12'));
      expect((await as(admin).delete(`/par-levels/${branch.id}/${item.id}`)).status).toBe(204);
      expect((await as(admin).delete(`/par-levels/${branch.id}/${item.id}`)).status).toBe(404);

      expect(
        (await as(finance).put(`/items/${item.id}/requisition-unit`, { requisitionUnit: '6' }))
          .status,
      ).toBe(403);
      const bad = await as(admin).put(`/items/${item.id}/requisition-unit`, {
        requisitionUnit: '0',
      });
      expect(bad.body).toMatchObject({
        code: 'INVALID_REQUISITION_UNIT',
        details: { problem: 'NOT_POSITIVE' },
      });
      const set = ok(
        await as(admin).put(`/items/${item.id}/requisition-unit`, { requisitionUnit: '6.000' }),
      );
      expect(set.requisitionUnit).toBe('6');
      const cleared = ok(
        await as(admin).put(`/items/${item.id}/requisition-unit`, { requisitionUnit: '' }),
      );
      expect(cleared.requisitionUnit).toBeNull();

      const trail = ok(await as(admin).get('/audit-logs').query({ entityType: 'ParLevel' }));
      const summaries = (trail.data as Body[]).map((e) => e.summary);
      expect(summaries).toEqual(
        expect.arrayContaining([
          `Set the par level of ${item.code} at ${branch.code} to 12 piece`,
          `Removed the par level of ${item.code} at ${branch.code}`,
        ]),
      );
    });
  });

  describe('who may do what', () => {
    it('branch managers raise, logistics fulfils, everyone in the chain reads', async () => {
      const s = await scene();
      const body = { branchId: s.branch.id, neededBy: today, lines: [] };
      expect((await as(logistics).post('/requisitions', body)).status).toBe(403);
      expect((await as(finance).post('/requisitions', body)).status).toBe(403);
      expect((await as(null).post('/requisitions', body)).status).toBe(401);
      const requisition = await submitted(s);
      expect(
        (
          await as(manager).post(`/requisitions/${requisition.id}/transfers`, {
            revision: requisition.revision,
          })
        ).status,
      ).toBe(403);
      for (const reader of [plant, logistics, finance, admin]) {
        expect((await as(reader).get(`/requisitions/${requisition.id}`)).status).toBe(200);
      }
    });
  });

  describe('logs and audit', () => {
    it('label the requisition’s requests with its number and branch, and audit every step', async () => {
      const s = await scene();
      const requisition = await submitted(s);
      const lines = ctx
        .logs()
        .filter(
          (l) =>
            l.labels?.event === 'http.request.completed' &&
            l.labels?.document_number === requisition.number,
        );
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.every((l) => l.labels?.location_code === s.branch.code)).toBe(true);

      const trail = ok(
        await as(admin)
          .get('/audit-logs')
          .query({ entityType: 'Requisition', entityId: requisition.id }),
      );
      expect((trail.data as Body[]).map((e) => e.summary).sort()).toEqual(
        [
          `Drafted requisition ${requisition.number} for ${s.branch.code} from ${s.origin.code}`,
          `Submitted requisition ${requisition.number}`,
        ].sort(),
      );
    });
  });
});

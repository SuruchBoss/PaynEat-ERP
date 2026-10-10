// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Transfers (#14), end to end against a real PostgreSQL: the demo transfers, dispatch through
 * in-transit with FEFO lots that never include an expired one, receipt with the goods receipt
 * inspection, every dispatched quantity accounted for as accepted, returned or written off,
 * approval by someone else holding the plant's role, two receipts of one transfer racing, stock in
 * transit per transfer, who may do what, and the logs and metrics.
 */
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { addDays } from 'src/core/time/domain/business-date';
import { DEMO_TRANSFERS } from '../prisma/demo-data';
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

describe('transfers (#14)', () => {
  let ctx: TestContext;
  let admin: Session;
  let plant: Session;
  let logistics: Session;
  let manager: Session;
  let finance: Session;
  let prisma: PrismaService;
  let today: string;
  let items: Map<string, Body>;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    admin = await signInAsAdmin(ctx.server);
    plant = await signIn(ctx.server, demoEmail('plant'));
    logistics = await signIn(ctx.server, demoEmail('logistics'));
    manager = await signIn(ctx.server, demoEmail('branch_manager'));
    finance = await signIn(ctx.server, demoEmail('finance'));
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

  /** A new account holding the given roles, signed in. */
  const person = async (roles: string[]): Promise<Session> => {
    const email = `${unique('staff').toLowerCase()}@example.test`;
    ok(
      await as(admin).post('/users', {
        email,
        displayName: 'สมหญิง ทดสอบ',
        password: TEST_PASSWORD,
        roles,
      }),
      201,
    );
    return signIn(ctx.server, email, TEST_PASSWORD);
  };

  /** Lots brought into a location by one opening balance dated `daysAgo` days before today. */
  const lotsAt = async (
    locationId: string,
    lines: ReadonlyArray<{
      item: string;
      quantity: string;
      pieces?: string;
      unitCost: string;
      expiresIn: number;
    }>,
    daysAgo = 1,
  ): Promise<Body[]> => {
    const draft = ok(
      await as(plant).post('/opening-balances', {
        locationId,
        businessDate: addDays(today, -daysAgo),
        lines: lines.map((l) => ({
          itemId: items.get(l.item)!.id,
          quantity: l.quantity,
          secondaryQuantity: l.pieces ?? null,
          unitCost: l.unitCost,
          expiryDate: addDays(today, l.expiresIn),
        })),
      }),
      201,
    );
    const posted = ok(
      await as(plant).post(`/opening-balances/${draft.id}/post`, { revision: draft.revision }),
    );
    return posted.lines.map((l: Body) => l.lot);
  };

  const draft = async (
    origin: Body,
    destination: Body,
    lines: ReadonlyArray<[string, string]>,
    extra: Body = {},
  ): Promise<Body> =>
    ok(
      await as(logistics).post('/transfers', {
        originId: origin.id,
        destinationId: destination.id,
        lines: lines.map(([item, quantity]) => ({ itemId: items.get(item)!.id, quantity })),
        ...extra,
      }),
      201,
    );

  /** The picks a draft suggests, as a dispatch request. */
  const suggested = (transfer: Body) =>
    transfer.lines.flatMap((l: Body) =>
      l.picks.map((p: Body) => ({
        lineNo: l.lineNo,
        lotId: p.lotId,
        quantity: p.quantity,
        pieces: p.pieces,
      })),
    );

  const dispatch = (transfer: Body, picks: Body[] = suggested(transfer)) =>
    as(logistics).post(`/transfers/${transfer.id}/dispatch`, {
      revision: transfer.revision,
      picks,
    });

  /** Every lot line arriving as it left, cold and in good condition, unless `change` says. */
  const arrival = (transfer: Body, change: (pick: Body, line: Body) => Body = () => ({})) =>
    transfer.lines.flatMap((line: Body) =>
      line.picks.map((pick: Body) => ({
        lineNo: pick.pickNo,
        received: pick.quantity,
        receivedPieces: pick.pieces,
        temperature: '3.2',
        condition: 'good',
        accepted: pick.quantity,
        acceptedPieces: pick.pieces,
        returned: '0',
        returnedPieces: pick.pieces === null ? null : '0',
        writtenOff: '0',
        writtenOffPieces: pick.pieces === null ? null : '0',
        ...change(pick, line),
      })),
    );

  const receive = (transfer: Body, lines: Body[], by: Session = manager, extra: Body = {}) =>
    as(by).post(`/transfers/${transfer.id}/receipts`, { lines, ...extra });

  const submit = (receipt: Body, by: Session = manager) =>
    as(by).post(`/transfer-receipts/${receipt.id}/submit`, { revision: receipt.revision });

  const balance = async (lotId: string, locationId: string): Promise<string | null> => {
    const row = await prisma.stockBalance.findUnique({
      where: { lotId_locationId: { lotId, locationId } },
    });
    return row ? row.quantity.toFixed() : null;
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
  const postings = (type: string, outcome: string, rule = '') =>
    metric('erp_postings_total', { document_type: type, outcome, rule });

  /** A new plant with breast pieces and whole chicken, and a new branch. */
  const route = async () => {
    const origin = await newLocation('plant');
    const destination = await newLocation('branch');
    const [breastOld, breastNew, chicken] = await lotsAt(origin.id, [
      { item: 'CHICKEN-BREAST', quantity: '15', unitCost: '23.5', expiresIn: 2 },
      { item: 'CHICKEN-BREAST', quantity: '40', unitCost: '24.25', expiresIn: 3 },
      { item: 'WHOLE-CHICKEN', quantity: '21.6', pieces: '12', unitCost: '72.5', expiresIn: 3 },
    ]);
    return { origin, destination, breastOld, breastNew, chicken };
  };

  describe('the demo seed', () => {
    it('moves pieces from the morning cut to each branch, one short and one warm, both approved by the plant', async () => {
      const list = ok(await as(finance).get('/transfers')) as Body[];
      const byBranch = new Map<string, Body>();
      for (const t of list) {
        if ((t.note ?? '').startsWith('Demo seed')) byBranch.set(t.destination.code, t);
      }
      expect([...byBranch.keys()].sort()).toEqual(
        DEMO_TRANSFERS.map((t) => t.destinationCode).sort(),
      );
      for (const t of byBranch.values()) expect(t.status).toBe('received');

      const ari = ok(await as(finance).get(`/transfers/${byBranch.get('BR-ARI')!.id}`));
      const wings = ari.lines.find((l: Body) => l.item.code === 'CHICKEN-WING');
      expect(wings).toMatchObject({
        dispatched: '30',
        accepted: '28',
        writtenOff: '2',
        returned: '0',
      });
      expect(ari.received.approvedBy.displayName).toBe('Demo plant');
      expect(ari.origin.code).toBe('PLANT-01');

      const bangna = ok(await as(finance).get(`/transfers/${byBranch.get('BR-BANGNA')!.id}`));
      const receipt = ok(await as(finance).get(`/transfer-receipts/${bangna.received.receipt.id}`));
      const breast = receipt.lines.find((l: Body) => l.item.code === 'CHICKEN-BREAST');
      expect(breast.findings).toEqual([{ code: 'too_warm', temperature: '5.1', limit: '4' }]);
      expect(receipt.approved.by.displayName).toBe('Demo plant');

      const silom = ok(await as(finance).get(`/transfers/${byBranch.get('BR-SILOM')!.id}`));
      expect(silom.received.approvedBy).toBeNull();
      // The pieces came from the production order: a lot numbered after it.
      expect(silom.lines[0].picks[0].number).toMatch(/^MO-/);
    });
  });

  describe('dispatch', () => {
    it('suggests FEFO lots, moves what left into in-transit at its own cost and expiry, and shows it per transfer', async () => {
      const { origin, destination, breastOld, breastNew, chicken } = await route();
      const transfer = await draft(origin, destination, [
        ['CHICKEN-BREAST', '20'],
        ['WHOLE-CHICKEN', '21.6'],
      ]);
      expect(transfer.status).toBe('draft');
      expect(transfer.number).toMatch(/^TR-\d{4}-\d{5}$/);
      expect(transfer.inTransit.code).toBe(`IN-TRANSIT:${origin.code}`);
      const breast = transfer.lines[0];
      expect(breast.picks.map((p: Body) => [p.lotId, p.quantity])).toEqual([
        [breastOld.id, '15'],
        [breastNew.id, '5'],
      ]);
      // Taking a whole variable-weight lot takes all its birds.
      expect(transfer.lines[1].picks).toEqual([
        expect.objectContaining({ lotId: chicken.id, quantity: '21.6', pieces: '12' }),
      ]);
      expect(transfer.blockers).toEqual([]);

      const dispatched = ok(await dispatch(transfer));
      expect(dispatched.status).toBe('dispatched');
      expect(dispatched.dispatched.by.displayName).toBe('Demo logistics');
      expect(dispatched.lines[0].picks.map((p: Body) => p.pickNo)).toEqual([1, 2]);
      expect(dispatched.lines[1].picks[0].pickNo).toBe(3);

      const inTransitId = dispatched.inTransit.id;
      expect(await balance(breastOld.id, origin.id)).toBe('0');
      expect(await balance(breastNew.id, origin.id)).toBe('35');
      expect(await balance(breastNew.id, inTransitId)).toBe('5');
      expect(await balance(chicken.id, inTransitId)).toBe('21.6');

      // Stock on hand shows it in transit, at the lot's own cost and expiry.
      const onHand = ok(await as(finance).get('/stock-on-hand').query({ locationId: inTransitId }));
      const row = onHand.rows.find((r: Body) => r.lot.id === chicken.id);
      expect(row).toMatchObject({ quantity: '21.600', secondaryQuantity: '12', unitCost: '72.5' });
      expect(row.lot.expiryDate).toBe(addDays(today, 3));

      // …and broken down by transfer, for anyone signed in.
      const inTransit = ok(await as(manager).get('/transfers/in-transit'));
      const mine = inTransit.transfers.find((t: Body) => t.transfer.id === transfer.id);
      expect(mine.inTransit.id).toBe(inTransitId);
      expect(mine.lots.map((l: Body) => [l.lot.id, l.quantity, l.pieces])).toEqual([
        [breastOld.id, '15', null],
        [breastNew.id, '5', null],
        [chicken.id, '21.6', '12'],
      ]);
      // Yesterday it was not on the road yet.
      const yesterday = ok(
        await as(manager)
          .get('/transfers/in-transit')
          .query({ asOf: addDays(today, -1) }),
      );
      expect(yesterday.transfers.some((t: Body) => t.transfer.id === transfer.id)).toBe(false);

      // Logged with its number and the origin's code; counted.
      expect(
        ctx
          .logs()
          .some(
            (l) =>
              l.labels?.event === 'ledger.posting.succeeded' &&
              l.labels?.document_number === dispatched.number &&
              l.labels?.location_code === origin.code,
          ),
      ).toBe(true);
      expect(await metric('erp_transfers_in_transit', { origin_code: origin.code })).toBe(1);
      expect(await postings('transfer', 'succeeded')).toBeGreaterThan(0);
    });

    it('never suggests an expired lot, and refuses one at dispatch, counted by rule', async () => {
      const origin = await newLocation('plant');
      const destination = await newLocation('branch');
      const [old, fresh] = await lotsAt(
        origin.id,
        [
          { item: 'CHICKEN-WING', quantity: '10', unitCost: '9', expiresIn: -1 },
          { item: 'CHICKEN-WING', quantity: '10', unitCost: '9.5', expiresIn: 2 },
        ],
        3,
      );
      const transfer = await draft(origin, destination, [['CHICKEN-WING', '12']]);
      const line = transfer.lines[0];
      expect(line.picks.map((p: Body) => p.lotId)).toEqual([fresh.id]);
      expect(line.shortBy).toBe('2');
      expect(line.availableLots.find((l: Body) => l.lotId === old.id).expired).toBe(true);

      const before = await postings('transfer', 'refused', 'expired_lot');
      const res = await dispatch(transfer, [
        { lineNo: 1, lotId: fresh.id, quantity: '10' },
        { lineNo: 1, lotId: old.id, quantity: '2' },
      ]);
      expect(res.status).toBe(422);
      expect(res.body.details).toMatchObject({ rule: 'expired_lot', lineNo: 1 });
      expect(await postings('transfer', 'refused', 'expired_lot')).toBe(before + 1);
      expect(await balance(old.id, origin.id)).toBe('10');
      const after = ok(await as(logistics).get(`/transfers/${transfer.id}`));
      expect(after.status).toBe('draft');
      expect(await prisma.transferPick.count({ where: { documentId: transfer.id } })).toBe(0);

      // Overriding FEFO with another usable lot is fine: what left is what is recorded.
      const sent = ok(await dispatch(after, [{ lineNo: 1, lotId: fresh.id, quantity: '10' }]));
      expect(sent.lines[0].dispatched).toBe('10');
    });

    it('refuses taking the origin below zero, a lot it does not hold, and a line with no lot', async () => {
      const { origin, destination, breastNew } = await route();
      const elsewhere = await route();
      const transfer = await draft(origin, destination, [
        ['CHICKEN-BREAST', '20'],
        ['CHICKEN-WING', '5'],
      ]);
      // Nothing of the wing at the plant: the line has no lot, and it shows.
      expect(transfer.blockers).toEqual([{ rule: 'nothing_picked', lineNo: 2 }]);
      let res = await dispatch(transfer);
      expect(res.status).toBe(422);
      expect(res.body.details).toMatchObject({ rule: 'nothing_picked', lineNo: 2 });

      const one = ok(
        await as(logistics).patch(`/transfers/${transfer.id}`, {
          revision: transfer.revision,
          lines: [{ itemId: items.get('CHICKEN-BREAST')!.id, quantity: '20' }],
        }),
      );
      res = await dispatch(one, [{ lineNo: 1, lotId: breastNew.id, quantity: '41' }]);
      expect(res.status).toBe(422);
      expect(res.body.details).toMatchObject({
        rule: 'negative_stock_plant',
        lotNumber: breastNew.number,
        locationCode: origin.code,
      });
      res = await dispatch(one, [{ lineNo: 1, lotId: elsewhere.breastNew.id, quantity: '1' }]);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_TRANSFER_PICK');
      expect(await balance(breastNew.id, origin.id)).toBe('40');
    });

    it('sends only from a plant or warehouse to a branch or warehouse, each item once', async () => {
      const origin = await newLocation('plant');
      const branch = await newLocation('branch');
      let res = await as(logistics).post('/transfers', {
        originId: branch.id,
        destinationId: origin.id,
        lines: [{ itemId: items.get('CHICKEN-WING')!.id, quantity: '1' }],
      });
      expect(res.status).toBe(422);
      expect(res.body.details.problem).toBe('ORIGIN_NOT_PLANT_OR_WAREHOUSE');
      res = await as(logistics).post('/transfers', {
        originId: origin.id,
        destinationId: branch.id,
        lines: [
          { itemId: items.get('CHICKEN-WING')!.id, quantity: '1' },
          { itemId: items.get('CHICKEN-WING')!.id, quantity: '2' },
        ],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_TRANSFER_LINE');
      res = await as(logistics).post('/transfers', {
        originId: origin.id,
        destinationId: branch.id,
        lines: [{ itemId: items.get('CHICKEN-WING')!.id, quantity: '1.5' }],
      });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/decimals/);
    });

    it('cancels a draft with a reason, and a cancelled transfer can never be dispatched', async () => {
      const { origin, destination } = await route();
      const transfer = await draft(origin, destination, [['CHICKEN-BREAST', '5']]);
      const cancelled = ok(
        await as(logistics).post(`/transfers/${transfer.id}/cancel`, {
          revision: transfer.revision,
          reason: 'Branch closed for the day',
        }),
      );
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelled.reason).toBe('Branch closed for the day');
      const res = await dispatch(cancelled, suggested(transfer));
      expect(res.status).toBe(409);
      expect(res.body.details.rule).toBe('cancelled');
    });
  });

  describe('receipt', () => {
    const sent = async () => {
      const r = await route();
      const transfer = ok(
        await dispatch(
          await draft(r.origin, r.destination, [
            ['CHICKEN-BREAST', '20'],
            ['WHOLE-CHICKEN', '21.6'],
          ]),
        ),
      );
      return { ...r, transfer, inTransitId: transfer.inTransit.id as string };
    };

    it('takes a clean receipt straight into the branch at the lots own cost and expiry, and leaves nothing in transit', async () => {
      const { destination, transfer, inTransitId, chicken, breastNew } = await sent();
      const receipt = ok(await receive(transfer, arrival(transfer)), 201);
      expect(receipt.number).toMatch(/^RT-\d{4}-\d{5}$/);
      expect(receipt.blockers).toEqual([]);
      expect(receipt.needsApproval).toBe(false);
      const posted = ok(await submit(receipt));
      expect(posted.status).toBe('posted');

      expect(await balance(chicken.id, inTransitId)).toBe('0');
      expect(await balance(chicken.id, destination.id)).toBe('21.6');
      expect(await balance(breastNew.id, destination.id)).toBe('5');
      const row = await prisma.stockBalance.findUniqueOrThrow({
        where: { lotId_locationId: { lotId: chicken.id, locationId: destination.id } },
      });
      expect(row.secondaryQuantity?.toFixed()).toBe('12');
      const entries = await prisma.ledgerEntry.findMany({
        where: { documentId: posted.id, locationId: destination.id, lotId: chicken.id },
      });
      expect(entries.map((e) => e.unitCost.toFixed())).toEqual(['72.5']);

      const after = ok(await as(logistics).get(`/transfers/${transfer.id}`));
      expect(after.status).toBe('received');
      expect(after.received.receipt.number).toBe(posted.number);
      expect(after.received.by.displayName).toBe('Demo branch manager');
      expect(after.lines[1]).toMatchObject({
        dispatched: '21.6',
        accepted: '21.6',
        writtenOff: '0',
      });
      const inTransit = ok(await as(manager).get('/transfers/in-transit'));
      expect(inTransit.transfers.some((t: Body) => t.transfer.id === transfer.id)).toBe(false);
      expect(
        ctx
          .logs()
          .some(
            (l) =>
              l.labels?.event === 'ledger.posting.succeeded' &&
              l.labels?.document_number === posted.number &&
              l.labels?.location_code === destination.code,
          ),
      ).toBe(true);
    });

    it('returns to the origin and writes off with reasons, after someone else holding the plant role approves', async () => {
      const { origin, destination, transfer, inTransitId, chicken, breastOld } = await sent();
      // Breast lot 1 (15 pieces): 13 arrived, 1 damaged goes back, 2 never came and are written
      // off. The birds lose 0.3 kg on the road with all twelve still there.
      const lines = arrival(transfer, (pick) =>
        pick.lotId === breastOld.id
          ? {
              received: '13',
              accepted: '12',
              returned: '1',
              writtenOff: '2',
              reason: 'One crushed tray goes back, two pieces missing',
            }
          : pick.lotId === chicken.id
            ? {
                received: '21.3',
                accepted: '21.3',
                writtenOff: '0.3',
                writtenOffPieces: '0',
                reason: 'Weight lost on the road',
              }
            : {},
      );
      const both = await person(['branch_manager', 'plant']);
      const receipt = ok(await receive(transfer, lines, both), 201);
      expect(receipt.needsApproval).toBe(true);
      const submitted = ok(await submit(receipt, both));
      expect(submitted.status).toBe('submitted');
      expect(await balance(chicken.id, destination.id)).toBeNull();

      // Holding both roles does not let anyone approve their own receipt (ADR-0008).
      const before = await postings('transfer_receipt', 'refused', 'self_approval');
      let res = await as(both).post(`/transfer-receipts/${receipt.id}/approve`, {
        revision: submitted.revision,
      });
      expect(res.status).toBe(422);
      expect(res.body.details.rule).toBe('self_approval');
      expect(await postings('transfer_receipt', 'refused', 'self_approval')).toBe(before + 1);
      // A branch manager cannot approve at all.
      res = await as(manager).post(`/transfer-receipts/${receipt.id}/approve`, {
        revision: submitted.revision,
      });
      expect(res.status).toBe(403);

      const approved = ok(
        await as(plant).post(`/transfer-receipts/${receipt.id}/approve`, {
          revision: submitted.revision,
        }),
      );
      expect(approved.status).toBe('posted');
      expect(approved.postingRefusal).toBeNull();
      expect(approved.approved.by.displayName).toBe('Demo plant');

      expect(await balance(breastOld.id, destination.id)).toBe('12');
      expect(await balance(breastOld.id, origin.id)).toBe('1');
      expect(await balance(breastOld.id, inTransitId)).toBe('0');
      expect(await balance(chicken.id, destination.id)).toBe('21.3');
      expect(await balance(chicken.id, inTransitId)).toBe('0');
      const transit = await prisma.stockBalance.findUniqueOrThrow({
        where: { lotId_locationId: { lotId: chicken.id, locationId: inTransitId } },
      });
      expect(transit.secondaryQuantity?.toFixed()).toBe('0');

      const after = ok(await as(finance).get(`/transfers/${transfer.id}`));
      const breast = after.lines[0];
      expect(breast).toMatchObject({
        dispatched: '20',
        accepted: '17',
        returned: '1',
        writtenOff: '2',
      });
      expect(breast.picks[0].outcome).toMatchObject({
        writtenOff: '2',
        writtenOffValue: '47',
        reason: 'One crushed tray goes back, two pieces missing',
      });
      expect(after.received.approvedBy.displayName).toBe('Demo plant');
    });

    it('refuses a receipt that would leave anything in transit, counted by rule', async () => {
      const { transfer } = await sent();
      const lines = arrival(transfer, (pick) =>
        pick.pickNo === 1 ? { received: '14', accepted: '14' } : {},
      );
      const receipt = ok(await receive(transfer, lines), 201);
      expect(receipt.blockers).toEqual([{ rule: 'difference_unresolved', lineNo: 1 }]);
      expect(receipt.lines[0].unresolved).toBe('1');
      const before = await postings('transfer_receipt', 'refused', 'difference_unresolved');
      const res = await submit(receipt);
      expect(res.status).toBe(422);
      expect(res.body.details).toMatchObject({ rule: 'difference_unresolved', lineNo: 1 });
      expect(await postings('transfer_receipt', 'refused', 'difference_unresolved')).toBe(
        before + 1,
      );

      // Resolving it (and saying why) is enough: a write-off then waits for the plant.
      const fixed = ok(
        await as(manager).patch(`/transfer-receipts/${receipt.id}`, {
          revision: receipt.revision,
          lines: arrival(transfer, (pick) =>
            pick.pickNo === 1
              ? { received: '14', accepted: '14', writtenOff: '1', reason: 'One piece short' }
              : {},
          ),
        }),
      );
      expect(fixed.blockers).toEqual([]);
      expect(ok(await submit(fixed)).status).toBe('submitted');
    });

    it('asks why for a finding, and sends a warm line to the plant for approval', async () => {
      const { transfer, destination, breastOld } = await sent();
      const warm = arrival(transfer, (pick) =>
        pick.lotId === breastOld.id ? { temperature: '5.1' } : {},
      );
      const receipt = ok(await receive(transfer, warm), 201);
      expect(receipt.lines[0].findings).toEqual([
        { code: 'too_warm', temperature: '5.1', limit: '4' },
      ]);
      expect(receipt.blockers).toEqual([{ rule: 'reason_required', lineNo: 1 }]);

      const explained = ok(
        await as(manager).patch(`/transfer-receipts/${receipt.id}`, {
          revision: receipt.revision,
          lines: arrival(transfer, (pick) =>
            pick.lotId === breastOld.id
              ? { temperature: '5.1', reason: 'Core checked at 3.8 °C' }
              : {},
          ),
        }),
      );
      const submitted = ok(await submit(explained));
      expect(submitted.status).toBe('submitted');
      // The finding is fixed on submission: what the approver sees is what was found.
      const stored = await prisma.transferReceiptLine.findUniqueOrThrow({
        where: { documentId_lineNo: { documentId: receipt.id, lineNo: 1 } },
      });
      expect(stored.findings).toEqual([{ code: 'too_warm', temperature: '5.1', limit: '4' }]);

      const rejected = ok(
        await as(plant).post(`/transfer-receipts/${receipt.id}/reject`, {
          revision: submitted.revision,
          reason: 'Measure the core again and raise a new receipt',
        }),
      );
      expect(rejected.status).toBe('rejected');
      expect(await balance(breastOld.id, destination.id)).toBeNull();
      // A rejected receipt is final; the branch raises a new one.
      const again = ok(await receive(transfer, arrival(transfer)), 201);
      expect(ok(await submit(again)).status).toBe('posted');
    });

    it('never takes a lot that expired on the road into the branch, but lets it go back', async () => {
      const origin = await newLocation('plant');
      const destination = await newLocation('branch');
      // Expires yesterday, dispatched yesterday (still usable that day), received today.
      const [lot] = await lotsAt(
        origin.id,
        [{ item: 'CHICKEN-THIGH', quantity: '8', unitCost: '18', expiresIn: -1 }],
        2,
      );
      const transfer = ok(
        await dispatch(
          await draft(origin, destination, [['CHICKEN-THIGH', '8']], {
            businessDate: addDays(today, -1),
          }),
        ),
      );
      const receipt = ok(await receive(transfer, arrival(transfer)), 201);
      expect(receipt.blockers).toEqual([{ rule: 'expired_on_arrival', lineNo: 1 }]);
      expect((await submit(receipt)).body.details.rule).toBe('expired_on_arrival');

      const back = ok(
        await as(manager).patch(`/transfer-receipts/${receipt.id}`, {
          revision: receipt.revision,
          lines: arrival(transfer, () => ({
            accepted: '0',
            returned: '8',
            reason: 'Expired on the way: back to the plant to be written off there',
          })),
        }),
      );
      const posted = ok(await submit(back));
      expect(posted.status).toBe('posted');
      expect(await balance(lot.id, origin.id)).toBe('8');
      expect(await balance(lot.id, destination.id)).toBeNull();
    });

    it('records every lot line once, and refuses accepting more than arrived', async () => {
      const { transfer } = await sent();
      const lines = arrival(transfer);
      let res = await receive(transfer, lines.slice(1));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('RECEIPT_LINES_MISSING');
      res = await receive(transfer, [...lines, lines[0]]);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_RECEIPT_LINE');
      res = await receive(
        transfer,
        arrival(transfer, (pick) => (pick.pickNo === 1 ? { received: '14', accepted: '15' } : {})),
      );
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/only what arrived can be accepted/);
    });
  });

  it('posts exactly one of two receipts of the same transfer submitted at once', async () => {
    const r = await route();
    const transfer = ok(
      await dispatch(await draft(r.origin, r.destination, [['CHICKEN-BREAST', '20']])),
    );
    const other = await person(['branch_manager']);
    const first = ok(await receive(transfer, arrival(transfer)), 201);
    const second = ok(await receive(transfer, arrival(transfer), other), 201);

    const before = await postings('transfer_receipt', 'refused', 'already_received');
    const [a, b] = await Promise.all([submit(first), submit(second, other)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.details.rule).toBe('already_received');
    expect(await postings('transfer_receipt', 'refused', 'already_received')).toBe(before + 1);

    const after = ok(await as(logistics).get(`/transfers/${transfer.id}`));
    expect(after.status).toBe('received');
    const winner = a.status === 200 ? a.body : b.body;
    expect(after.received.receipt.id).toBe(winner.id);
    // Nothing below zero in transit, and the branch has the twenty pieces once.
    expect(await balance(r.breastOld.id, transfer.inTransit.id)).toBe('0');
    expect(await balance(r.breastOld.id, r.destination.id)).toBe('15');
    expect(await balance(r.breastNew.id, r.destination.id)).toBe('5');
    // A third receipt cannot even be raised.
    const third = await receive(transfer, arrival(transfer));
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('TRANSFER_NOT_RECEIVABLE');
  });

  it('lets logistics dispatch, branch managers receive, and finance only read', async () => {
    const { origin, destination } = await route();
    const body = {
      originId: origin.id,
      destinationId: destination.id,
      lines: [{ itemId: items.get('CHICKEN-BREAST')!.id, quantity: '1' }],
    };
    expect((await as(manager).post('/transfers', body)).status).toBe(403);
    expect((await as(finance).post('/transfers', body)).status).toBe(403);
    expect((await as(plant).post('/transfers', body)).status).toBe(403);
    const transfer = ok(
      await dispatch(await draft(origin, destination, [['CHICKEN-BREAST', '1']])),
    );
    expect((await receive(transfer, arrival(transfer), logistics)).status).toBe(403);
    expect((await as(finance).get(`/transfers/${transfer.id}`)).status).toBe(200);
    expect((await as(admin).get(`/transfers/${transfer.id}`)).status).toBe(403);
    expect((await as(null).get('/transfers/in-transit')).status).toBe(401);
  });
});

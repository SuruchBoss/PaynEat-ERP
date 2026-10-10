// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Production BOMs (#12), end to end against a real PostgreSQL: the demo BOMs, create with the
 * default weight-share ratios, overridden ratios that must add up to 100, new versions that
 * never overlap or start early, corrections only before a version starts, who may read and
 * change them, and the audit trail.
 */
import request from 'supertest';
import { PrismaService } from 'src/core/prisma/prisma.service';
import { addDays } from 'src/core/time/domain/business-date';
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

describe('production BOMs (#12)', () => {
  let ctx: TestContext;
  let admin: Session;
  let plant: Session;
  let finance: Session;
  let purchasing: Session;
  let branchManager: Session;
  let prisma: PrismaService;
  let today: string;
  let items: Map<string, Body>;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    admin = await signInAsAdmin(ctx.server);
    plant = await signIn(ctx.server, demoEmail('plant'));
    finance = await signIn(ctx.server, demoEmail('finance'));
    purchasing = await signIn(ctx.server, demoEmail('purchasing'));
    branchManager = await signIn(ctx.server, demoEmail('branch_manager'));
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

  /** The worked example: one case of whole chicken cut into pieces and frames. */
  const cutting = (overrides: string[] | null = null) => ({
    inputs: [{ itemId: itemId('WHOLE-CHICKEN'), quantity: '20' }],
    outputs: [
      ['CHICKEN-BREAST', '22', '5'],
      ['CHICKEN-THIGH', '22', '3.6'],
      ['CHICKEN-DRUMSTICK', '22', '2.8'],
      ['CHICKEN-WING', '22', '2.2'],
      ['CHICKEN-FRAME', '4.4', null],
    ].map(([code, quantity, weight], i) => ({
      itemId: itemId(code!),
      quantity,
      ...(weight ? { expectedWeightKg: weight } : {}),
      ...(overrides ? { allocationRatio: overrides[i] } : {}),
    })),
  });

  const create = (session: Session, body: object = {}) =>
    as(session).post('/production-boms', {
      code: unique('BOM'),
      nameTh: 'ตัดไก่ทดสอบ',
      nameEn: 'Test cutting',
      locationType: 'plant',
      effectiveFrom: today,
      ...cutting(),
      ...body,
    });

  it('seeds the cutting BOM with overridden ratios and the batter mix with the default', async () => {
    const list = await as(plant).get('/production-boms');
    expect(list.status).toBe(200);
    const byCode = new Map<string, Body>(list.body.map((b: Body) => [b.code, b]));
    expect(byCode.get('CUT-WHOLE-CHICKEN')).toMatchObject({
      locationType: 'plant',
      active: true,
      current: { number: 1, effectiveFrom: addDays(today, -1), yieldPercent: '90.00' },
      scheduled: null,
    });

    const cut = await as(finance).get(`/production-boms/${byCode.get('CUT-WHOLE-CHICKEN')!.id}`);
    expect(cut.status).toBe(200);
    const [version] = cut.body.versions;
    expect(version).toMatchObject({
      status: 'current',
      ratiosOverridden: true,
      inputWeightKg: '20.000',
      outputWeightKg: '18.000',
      wasteKg: '2.000',
      yieldPercent: '90.00',
    });
    expect(
      version.outputs.map((o: Body) => [
        o.item.code,
        o.weightKg,
        o.allocationRatio,
        o.yieldPercent,
      ]),
    ).toEqual([
      ['CHICKEN-BREAST', '5.000', '35.00', '25.00'],
      ['CHICKEN-THIGH', '3.600', '22.00', '18.00'],
      ['CHICKEN-DRUMSTICK', '2.800', '18.00', '14.00'],
      ['CHICKEN-WING', '2.200', '17.00', '11.00'],
      ['CHICKEN-FRAME', '4.400', '8.00', '22.00'],
    ]);

    const batter = await as(admin).get(`/production-boms/${byCode.get('MIX-BATTER')!.id}`);
    expect(batter.body.versions[0]).toMatchObject({
      ratiosOverridden: false,
      inputWeightKg: '26.000',
      outputWeightKg: '25.800',
      wasteKg: '0.200',
      yieldPercent: '99.23',
    });
    expect(batter.body.versions[0].outputs[0].allocationRatio).toBe('100.00');
  });

  it('creates a BOM whose ratios default to each output’s share of expected weight', async () => {
    const res = await create(admin);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ locationType: 'plant', active: true, revision: 1, today });
    const [version] = res.body.versions;
    expect(version).toMatchObject({
      number: 1,
      effectiveFrom: today,
      status: 'current',
      ratiosOverridden: false,
      wasteKg: '2.000',
      yieldPercent: '90.00',
    });
    expect(version.outputs.map((o: Body) => o.allocationRatio)).toEqual([
      '27.78',
      '20.00',
      '15.56',
      '12.22',
      '24.44',
    ]);
    expect(version.outputs[4]).toMatchObject({ expectedWeightKg: null, weightKg: '4.400' });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'ProductionBom', entityId: res.body.id },
    });
    expect(audit?.summary).toContain(`Created production BOM ${res.body.code}`);
  });

  it('previews weights, yield and default ratios while a version is entered, writing nothing', async () => {
    const before = await prisma.productionBomVersion.count();
    const partial = cutting();
    partial.outputs[0] = { ...partial.outputs[0], allocationRatio: '40' } as never;
    const res = await as(admin).post('/production-boms/preview', partial);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      issues: [],
      problems: ['ratios_incomplete'],
      statedRatioTotal: '40.00',
      figures: { inputWeightKg: '20.000', wasteKg: '2.000', yieldPercent: '90.00' },
    });
    expect(res.body.figures.outputs.map((o: Body) => o.defaultRatio)).toEqual([
      '27.78',
      '20.00',
      '15.56',
      '12.22',
      '24.44',
    ]);

    const broken = cutting();
    broken.outputs[1] = { ...broken.outputs[1], quantity: 'abc' };
    const invalid = await as(admin).post('/production-boms/preview', broken);
    expect(invalid.body).toMatchObject({
      issues: [{ side: 'output', lineNo: 2, problem: 'not_a_decimal' }],
      figures: null,
    });
    expect(await prisma.productionBomVersion.count()).toBe(before);
    expect((await as(finance).post('/production-boms/preview', cutting())).status).toBe(403);
  });

  it('refuses a code already taken', async () => {
    const res = await create(admin, { code: 'CUT-WHOLE-CHICKEN' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRODUCTION_BOM_CODE_TAKEN');
  });

  it('refuses ratios that do not add up to 100, or cover only some outputs', async () => {
    const off = await create(admin, cutting(['35', '22', '18', '17', '7.99']));
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('INVALID_PRODUCTION_BOM');
    expect(off.body.details.problems).toEqual(['ratios_not_100']);

    const some = cutting();
    some.outputs[0] = { ...some.outputs[0], allocationRatio: '50' } as never;
    const partial = await create(admin, some);
    expect(partial.status).toBe(422);
    expect(partial.body.details.problems).toEqual(['ratios_incomplete']);

    const negative = await create(admin, cutting(['-5', '30', '30', '30', '15']));
    expect(negative.status).toBe(422);
    expect(negative.body.details.issues).toEqual([
      { side: 'output', lineNo: 1, problem: 'ratio_invalid' },
    ]);
  });

  it('refuses outputs heavier than the inputs, missing weights and an item on both sides', async () => {
    const heavy = cutting();
    heavy.inputs[0].quantity = '17';
    const res = await create(admin, heavy);
    expect(res.status).toBe(422);
    expect(res.body.details.problems).toEqual(['outputs_heavier_than_inputs']);

    const noWeight = cutting();
    delete (noWeight.outputs[0] as { expectedWeightKg?: string }).expectedWeightKg;
    noWeight.outputs.push({ itemId: itemId('WHOLE-CHICKEN'), quantity: '1' });
    const lines = await create(admin, noWeight);
    expect(lines.status).toBe(422);
    expect(lines.body.details.issues).toEqual([
      { side: 'output', lineNo: 1, problem: 'weight_missing' },
      { side: 'output', lineNo: 6, problem: 'on_both_sides' },
    ]);
  });

  it('refuses default ratios that would give a very light output 0.00, and says which (#69)', async () => {
    // 1 g of wing trim against 50 kg of frames is 0.0019999 % of the output weight: cut to
    // 0.01 % it is 0.00, and the largest remainder hands the missing hundredth to the frames.
    const light = {
      inputs: [{ itemId: itemId('WHOLE-CHICKEN'), quantity: '50.001' }],
      outputs: [
        { itemId: itemId('CHICKEN-FRAME'), quantity: '50' },
        { itemId: itemId('CHICKEN-WING'), quantity: '1', expectedWeightKg: '0.001' },
      ],
    };
    const before = await prisma.productionBomVersion.count();

    const preview = await as(admin).post('/production-boms/preview', light);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      issues: [],
      problems: ['default_ratio_zero'],
      zeroRatioOutputs: [2],
      figures: { outputs: [{ defaultRatio: '100.00' }, { defaultRatio: '0.00' }] },
    });

    const res = await create(admin, light);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_PRODUCTION_BOM');
    expect(res.body.message).toContain('output line 2');
    expect(res.body.details).toEqual({
      issues: [],
      problems: ['default_ratio_zero'],
      zeroRatioOutputs: [2],
    });
    expect(await prisma.productionBomVersion.count()).toBe(before);

    // Stating the ratios is the way out; a stated ratio of zero was already refused.
    const stated = {
      ...light,
      outputs: light.outputs.map((line, i) => ({ ...line, allocationRatio: ['99', '1'][i] })),
    };
    const ok = await create(admin, stated);
    expect(ok.status).toBe(201);
    expect(ok.body.versions[0].outputs.map((o: Body) => o.allocationRatio)).toEqual([
      '99.00',
      '1.00',
    ]);
  });

  it('adds versions that never overlap or start before tomorrow once one is in force', async () => {
    const bom = (await create(admin)).body;
    const tooEarly = await as(admin).post(`/production-boms/${bom.id}/versions`, {
      effectiveFrom: today,
      ...cutting(),
    });
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body).toMatchObject({
      code: 'PRODUCTION_BOM_TOO_EARLY',
      details: { earliest: addDays(today, 1) },
    });

    const tomorrow = addDays(today, 1);
    const added = await as(admin).post(`/production-boms/${bom.id}/versions`, {
      effectiveFrom: tomorrow,
      ...cutting(['35', '22', '18', '17', '8']),
    });
    expect(added.status).toBe(201);
    expect(added.body.versions.map((v: Body) => [v.number, v.status, v.ratiosOverridden])).toEqual([
      [2, 'scheduled', true],
      [1, 'current', false],
    ]);

    const overlap = await as(admin).post(`/production-boms/${bom.id}/versions`, {
      effectiveFrom: tomorrow,
      ...cutting(),
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('PRODUCTION_BOM_VERSION_OVERLAP');

    const list = await as(plant).get('/production-boms');
    expect(list.body.find((b: Body) => b.id === bom.id)).toMatchObject({
      current: { number: 1 },
      scheduled: { number: 2, effectiveFrom: tomorrow },
    });
  });

  it('corrects a scheduled version, never one in force', async () => {
    const bom = (await create(admin)).body;
    const added = await as(admin).post(`/production-boms/${bom.id}/versions`, {
      effectiveFrom: addDays(today, 3),
      ...cutting(),
    });
    const [scheduled, current] = added.body.versions;

    const corrected = await as(admin).put(
      `/production-boms/versions/${scheduled.id}`,
      cutting(['40', '20', '15', '15', '10']),
    );
    expect(corrected.status).toBe(200);
    expect(corrected.body.versions[0]).toMatchObject({ number: 2, ratiosOverridden: true });
    expect(corrected.body.versions[0].outputs.map((o: Body) => o.allocationRatio)).toEqual([
      '40.00',
      '20.00',
      '15.00',
      '15.00',
      '10.00',
    ]);
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'ProductionBomVersion', entityId: scheduled.id, action: 'UPDATE' },
    });
    expect(audit?.summary).toContain('Corrected version 2');

    const locked = await as(admin).put(`/production-boms/versions/${current.id}`, cutting());
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('PRODUCTION_BOM_VERSION_IN_EFFECT');
  });

  it('renames and deactivates a BOM from its current revision only', async () => {
    const bom = (await create(admin)).body;
    const renamed = await as(admin).patch(`/production-boms/${bom.id}`, {
      revision: 1,
      nameEn: 'Renamed cutting',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ nameEn: 'Renamed cutting', revision: 2 });

    const stale = await as(admin).patch(`/production-boms/${bom.id}`, {
      revision: 1,
      active: false,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_REVISION');

    const off = await as(admin).patch(`/production-boms/${bom.id}`, { revision: 2, active: false });
    expect(off.body).toMatchObject({ active: false, revision: 3 });
    const listed = await as(admin).get('/production-boms');
    expect(listed.body.some((b: Body) => b.id === bom.id)).toBe(false);
    const all = await as(admin).get('/production-boms').query({ includeInactive: 'true' });
    expect(all.body.some((b: Body) => b.id === bom.id)).toBe(true);

    const versionOnInactive = await as(admin).post(`/production-boms/${bom.id}/versions`, {
      effectiveFrom: addDays(today, 1),
      ...cutting(),
    });
    expect(versionOnInactive.status).toBe(409);
    expect(versionOnInactive.body.code).toBe('PRODUCTION_BOM_INACTIVE');
  });

  it('lets plant and finance read, only the admin change, and nobody else in', async () => {
    const [demo] = (await as(admin).get('/production-boms')).body;
    for (const session of [plant, finance]) {
      expect((await as(session).get('/production-boms')).status).toBe(200);
      expect((await as(session).get(`/production-boms/${demo.id}`)).status).toBe(200);
      expect((await create(session)).status).toBe(403);
    }
    for (const session of [purchasing, branchManager]) {
      expect((await as(session).get('/production-boms')).status).toBe(403);
      expect((await as(session).get(`/production-boms/${demo.id}`)).status).toBe(403);
    }
    expect((await as(null).get('/production-boms')).status).toBe(401);
    expect(
      (await as(plant).patch(`/production-boms/${demo.id}`, { revision: 1, nameEn: 'x' })).status,
    ).toBe(403);
  });
});

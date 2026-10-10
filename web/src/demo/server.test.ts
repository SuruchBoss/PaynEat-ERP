// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from 'vitest';
import { stockValue, sumValues } from '@backend/src/core/quantity/domain/stock-value';
import { thaiTaxIdProblem } from '@backend/src/modules/suppliers/domain/thai-tax-id';
import { hotp, timeStep } from './totp';
import {
  DEMO_ITEMS,
  DEMO_MENU_ITEMS,
  DEMO_MFA_SECRET,
  DEMO_MODIFIER_GROUPS,
  DEMO_OPENING_BALANCE,
  DEMO_PASSWORD,
  DEMO_RECOVERY_CODES,
  DEMO_WRITE_OFF,
} from './seed';
import { DemoServer, type DemoResponse } from './server';

/** 10:00 in Bangkok on 26 September 2026: the demo's business date is 2026-09-26. */
const NOW = Date.UTC(2026, 8, 26, 3, 0, 0);
let clock = NOW;
let server: DemoServer;

beforeEach(() => {
  clock = NOW;
  server = new DemoServer({ now: () => clock });
});

interface Call {
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

function call(method: string, url: string, { body, token, headers }: Call = {}) {
  const sent = new Headers(headers);
  if (token) sent.set('authorization', `Bearer ${token}`);
  return server.handle({ method, url, headers: sent, body });
}

// The answers are JSON: tests read them loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (response: DemoResponse) => response.body as any;

const EMAIL = {
  admin: 'admin@demo-chicken.example',
  purchasing: 'purchasing@demo-chicken.example',
  plant: 'plant@demo-chicken.example',
  finance: 'finance@demo-chicken.example',
};

async function signIn(role: keyof typeof EMAIL): Promise<string> {
  const login = json(
    await call('POST', '/api/v1/auth/login', {
      body: { email: EMAIL[role], password: DEMO_PASSWORD },
    }),
  );
  if (!login.mfaRequired) return login.accessToken;
  const code = await hotp(DEMO_MFA_SECRET, timeStep(clock));
  const session = await call('POST', '/api/v1/auth/mfa/verify', {
    body: { challengeToken: login.challengeToken, code },
  });
  return json(session).accessToken;
}

function expectRefusal(response: DemoResponse, status: number, code: string) {
  expect({ status: response.status, code: json(response).code }).toEqual({ status, code });
}

describe('the demo API: what anyone may ask', () => {
  it('reports itself up and says this is a demo installation', async () => {
    expect(json(await call('GET', '/health'))).toEqual({
      status: 'ok',
      api: 'up',
      database: 'up',
    });
    expect(json(await call('GET', '/api/v1/installation'))).toEqual({ demo: true });
  });

  it('answers a refusal with the API error body, echoing the request id', async () => {
    const response = await call('GET', '/api/v1/items', {
      headers: { 'x-request-id': 'erp-web-0123456789abcdef' },
    });
    expect(response.status).toBe(401);
    expect(response.requestId).toBe('erp-web-0123456789abcdef');
    expect(json(response)).toEqual({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'Unauthorized',
      path: '/api/v1/items',
      requestId: 'erp-web-0123456789abcdef',
      timestamp: new Date(NOW).toISOString(),
    });
  });

  it('says plainly when a path is not in the demo, instead of failing some other way', async () => {
    const token = await signIn('plant');
    const response = await call('GET', '/api/v1/purchase-orders', { token });
    expectRefusal(response, 404, 'NOT_IN_DEMO');
  });

  it('serves only the API paths', () => {
    expect(DemoServer.handles('/health')).toBe(true);
    expect(DemoServer.handles('/api/v1/items')).toBe(true);
    expect(DemoServer.handles('/PaynEat-ERP/items')).toBe(false);
    expect(DemoServer.handles('/api/v10/items')).toBe(false);
  });
});

describe('the demo API: signing in', () => {
  it('signs a plant user in with the published password', async () => {
    const token = await signIn('plant');
    const me = json(await call('GET', '/api/v1/auth/me', { token }));
    expect(me).toMatchObject({
      email: EMAIL.plant,
      roles: ['plant'],
      permissions: [
        'opening_balance:manage',
        'stock_adjustment:raise',
        'purchase_order:read',
        'goods_receipt:read',
        'goods_receipt:receive',
        'production_bom:read',
        'production_order:read',
        'production_order:run',
      ],
      mfaEnabled: false,
    });
  });

  it('refuses a wrong password, and locks the account after five', async () => {
    const wrong = { body: { email: EMAIL.plant, password: 'not-the-password' } };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expectRefusal(await call('POST', '/api/v1/auth/login', wrong), 401, 'INVALID_CREDENTIALS');
    }
    const locked = await call('POST', '/api/v1/auth/login', {
      body: { email: EMAIL.plant, password: DEMO_PASSWORD },
    });
    expectRefusal(locked, 422, 'ACCOUNT_LOCKED');
  });

  it('asks the admin for a second factor and takes a code from the published secret once', async () => {
    const login = json(
      await call('POST', '/api/v1/auth/login', {
        body: { email: EMAIL.admin, password: DEMO_PASSWORD },
      }),
    );
    expect(login).toMatchObject({ mfaRequired: true, mfaEnrolled: true, expiresIn: 300 });
    const code = await hotp(DEMO_MFA_SECRET, timeStep(clock));
    const verify = () =>
      call('POST', '/api/v1/auth/mfa/verify', {
        body: { challengeToken: login.challengeToken, code },
      });
    const session = json(await verify());
    expect(session.user.permissions).toContain('user:manage');
    expectRefusal(await verify(), 401, 'SECOND_FACTOR_REJECTED');
  });

  it('takes each published recovery code once', async () => {
    const challenge = async () =>
      json(
        await call('POST', '/api/v1/auth/login', {
          body: { email: EMAIL.admin, password: DEMO_PASSWORD },
        }),
      ).challengeToken;
    const recover = async () =>
      call('POST', '/api/v1/auth/mfa/verify', {
        body: { challengeToken: await challenge(), code: DEMO_RECOVERY_CODES[0].toLowerCase() },
      });
    expect((await recover()).status).toBe(200);
    expectRefusal(await recover(), 401, 'SECOND_FACTOR_REJECTED');
  });

  it('refuses a request without a session, and one the roles do not allow', async () => {
    expectRefusal(await call('GET', '/api/v1/items'), 401, 'UNAUTHENTICATED');
    const token = await signIn('plant');
    const item = await call('POST', '/api/v1/items', { token, body: {} });
    expectRefusal(item, 403, 'ACCESS_DENIED');
  });

  it('rotates the refresh token, and signing out ends the session', async () => {
    const login = json(
      await call('POST', '/api/v1/auth/login', {
        body: { email: EMAIL.plant, password: DEMO_PASSWORD },
      }),
    );
    const refreshed = json(
      await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: login.refreshToken } }),
    );
    expect(refreshed.accessToken).not.toBe(login.accessToken);
    const reused = await call('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: login.refreshToken },
    });
    expectRefusal(reused, 401, 'SESSION_ENDED');

    const token = refreshed.accessToken;
    const out = await call('POST', '/api/v1/auth/logout', {
      token,
      body: { refreshToken: refreshed.refreshToken },
    });
    expect(out).toMatchObject({ status: 204, body: undefined });
    expectRefusal(await call('GET', '/api/v1/auth/me', { token }), 401, 'UNAUTHENTICATED');
  });

  it('expires an access token after fifteen minutes', async () => {
    const token = await signIn('plant');
    clock += 16 * 60_000;
    expectRefusal(await call('GET', '/api/v1/auth/me', { token }), 401, 'UNAUTHENTICATED');
  });

  it('keeps a session across a reload, which starts the data again', async () => {
    const token = await signIn('plant');
    server = new DemoServer({ now: () => clock });
    expect((await call('GET', '/api/v1/auth/me', { token })).status).toBe(200);
  });
});

describe('the demo API: users', () => {
  it('creates a user and refuses a weak password or a taken email', async () => {
    const token = await signIn('admin');
    const user = {
      email: 'new.cook@demo-chicken.example',
      displayName: 'New cook',
      password: 'a-long-enough-passphrase',
      locale: 'en',
      roles: ['branch_manager'],
    };
    const created = await call('POST', '/api/v1/users', { token, body: user });
    expect(created.status).toBe(201);
    expect(json(created)).toMatchObject({ email: user.email, mfaRequired: false });

    const weak = await call('POST', '/api/v1/users', {
      token,
      body: { ...user, email: 'x@demo-chicken.example', password: 'short' },
    });
    expectRefusal(weak, 422, 'WEAK_PASSWORD');
    expectRefusal(await call('POST', '/api/v1/users', { token, body: user }), 409, 'EMAIL_TAKEN');
  });

  it('keeps the admin role on the last active administrator', async () => {
    const token = await signIn('admin');
    const admin = json(await call('GET', '/api/v1/auth/me', { token }));
    const revoke = await call('DELETE', `/api/v1/users/${admin.id}/roles/admin`, { token });
    expectRefusal(revoke, 409, 'LAST_ADMIN');
  });
});

describe('the demo API: master data', () => {
  it('lists the seed items by code and refuses a stale edit', async () => {
    const token = await signIn('admin');
    const items = json(await call('GET', '/api/v1/items?status=all', { token }));
    expect(items).toHaveLength(DEMO_ITEMS.length);
    expect(items[0].code).toBe('BATTER-MIX');

    const flour = items.find((i: { code: string }) => i.code === 'FLOUR');
    const change = (version: number) =>
      call('PATCH', `/api/v1/items/${flour.id}`, { token, body: { version, shelfLifeDays: 90 } });
    const saved = json(await change(flour.version));
    expect(saved).toMatchObject({ shelfLifeDays: 90 });
    expect(saved.version).toBeGreaterThan(flour.version);
    const stale = await change(flour.version);
    expectRefusal(stale, 409, 'ITEM_CHANGED');
    expect(json(stale).details).toEqual({ currentVersion: saved.version });
  });

  it("keeps the demo chicken's receiving tolerances and lets the admin change them (#11)", async () => {
    const token = await signIn('admin');
    const items = json(await call('GET', '/api/v1/items?status=all', { token }));
    const chicken = items.find((i: { code: string }) => i.code === 'WHOLE-CHICKEN');
    expect(chicken.receivingTolerances).toEqual({ maxVariancePercent: '2', maxTemperature: '4' });
    const path = `/api/v1/items/${chicken.id}/receiving-tolerances`;
    const saved = json(
      await call('PUT', path, {
        token,
        body: { maxVariancePercent: '1.50', maxTemperature: null },
      }),
    );
    expect(saved.receivingTolerances).toEqual({ maxVariancePercent: '1.5', maxTemperature: null });
    expect(saved.version).toBe(chicken.version);
    expectRefusal(
      await call('PUT', path, { token, body: { maxVariancePercent: '101' } }),
      422,
      'INVALID_RECEIVING_TOLERANCES',
    );
    const plant = await signIn('plant');
    expect((await call('PUT', path, { token: plant, body: {} })).status).toBe(403);
  });

  it('refuses a taken item code, a purchase unit that is the base unit, and a zero factor', async () => {
    const token = await signIn('admin');
    const item = {
      code: 'flour',
      nameTh: 'แป้ง',
      nameEn: 'Flour',
      baseUnitCode: 'kg',
      variableWeight: false,
      shelfLifeDays: 30,
      purchaseUnits: [],
    };
    expectRefusal(
      await call('POST', '/api/v1/items', { token, body: item }),
      409,
      'ITEM_CODE_TAKEN',
    );
    const units = await call('POST', '/api/v1/items', {
      token,
      body: { ...item, code: 'RICE', purchaseUnits: [{ unitCode: 'kg', factor: '1' }] },
    });
    expectRefusal(units, 422, 'INVALID_PURCHASE_UNITS');
    expect(json(units).details.issues).toEqual([
      { index: 0, unitCode: 'kg', problem: 'SAME_AS_BASE_UNIT' },
    ]);
    const zero = await call('POST', '/api/v1/items', {
      token,
      body: { ...item, code: 'RICE', purchaseUnits: [{ unitCode: 'bag', factor: '0' }] },
    });
    expect(json(zero).details.issues).toEqual([
      { index: 0, unitCode: 'bag', problem: 'NOT_POSITIVE' },
    ]);
  });

  it('lists sites by type, and a new warehouse brings its in-transit location', async () => {
    const token = await signIn('admin');
    const codes = async () =>
      json(await call('GET', '/api/v1/locations?status=all', { token })).map(
        (l: { code: string }) => l.code,
      );
    expect(await codes()).toEqual([
      'PLANT-01',
      'BR-ARI',
      'BR-BANGNA',
      'BR-SILOM',
      'IN-TRANSIT:PLANT-01',
    ]);
    const created = await call('POST', '/api/v1/locations', {
      token,
      body: { code: ' wh-01 ', type: 'warehouse', nameTh: 'คลังกลาง', nameEn: 'Central store' },
    });
    expect(created.status).toBe(201);
    expect(json(created).inTransit.code).toBe('IN-TRANSIT:WH-01');
  });

  it('fixes a location code once a posted document used it', async () => {
    const token = await signIn('admin');
    const plant = json(await call('GET', '/api/v1/locations?status=all', { token }))[0];
    expect(plant.firstUse).toMatch(/^posted document OB-2026-00001$/);
    const change = await call('PATCH', `/api/v1/locations/${plant.id}`, {
      token,
      body: { revision: plant.revision, code: 'PLANT-02' },
    });
    expectRefusal(change, 422, 'LOCATION_CODE_IN_USE');
    const bad = await call('POST', '/api/v1/locations', {
      token,
      body: { code: '-X', type: 'branch', nameTh: 'x', nameEn: 'x' },
    });
    expectRefusal(bad, 422, 'INVALID_LOCATION_CODE');
    expect(json(bad).details).toEqual({ problem: 'BAD_FIRST_CHARACTER' });
  });

  it('checks a supplier tax id and refuses a stale edit', async () => {
    const token = await signIn('purchasing');
    const supplier = {
      code: 'SUP-PACKAGING',
      name: 'Demo Packaging (fictional)',
      taxId: '0000000000002',
      contactName: '',
    };
    const bad = await call('POST', '/api/v1/suppliers', { token, body: supplier });
    expectRefusal(bad, 422, 'INVALID_TAX_ID');
    expect(json(bad).details).toEqual({ problem: 'CHECK_DIGIT' });

    // Printed with separators; stored as 13 digits.
    const valid = '0-0000-00000-01-9';
    expect(thaiTaxIdProblem('0000000000019')).toBeNull();
    const created = json(
      await call('POST', '/api/v1/suppliers', { token, body: { ...supplier, taxId: valid } }),
    );
    expect(created).toMatchObject({
      code: 'SUP-PACKAGING',
      taxId: '0000000000019',
      contactName: null,
      revision: 1,
    });
    const edit = (revision: number) =>
      call('PATCH', `/api/v1/suppliers/${created.id}`, {
        token,
        body: { revision, phone: '02-000-0003' },
      });
    expect(json(await edit(1)).revision).toBe(2);
    expectRefusal(await edit(1), 409, 'SUPPLIER_CHANGED');
  });
});

describe('the demo API: stock', () => {
  // The opening balance, less the approved write-off on one of its lots (#8).
  const writtenOff = DEMO_OPENING_BALANCE.lines[DEMO_WRITE_OFF.openingBalanceLineNo - 1];
  const SEED_VALUE = sumValues([
    ...DEMO_OPENING_BALANCE.lines.map((l) => stockValue(l.quantity, l.unitCost)),
    stockValue(DEMO_WRITE_OFF.quantity, writtenOff.unitCost),
  ]);

  it('shows the seed stock at the plant today, and none before it was brought in', async () => {
    const token = await signIn('finance');
    const today = json(await call('GET', '/api/v1/stock-on-hand', { token }));
    expect(today.asOf).toBe('2026-09-26');
    expect(today.rows).toHaveLength(5);
    expect(today.totalValue).toBe(SEED_VALUE);
    expect(today.rows[0]).toMatchObject({
      item: { code: 'FLOUR' },
      lot: { number: 'OB-2026-00001/1' },
      quantity: '250.000',
    });
    expect(
      today.rows.find(
        (r: { lot: { number: string } }) =>
          r.lot.number === `OB-2026-00001/${DEMO_WRITE_OFF.openingBalanceLineNo}`,
      ),
    ).toMatchObject({ quantity: '19.800', secondaryQuantity: '11', countRecommended: false });
    expect(today.negativeBranchBalances).toBe(0);
    const before = json(await call('GET', '/api/v1/stock-on-hand?asOf=2026-09-24', { token }));
    expect(before.rows).toEqual([]);
    const future = await call('GET', '/api/v1/stock-on-hand?asOf=2026-09-27', { token });
    expectRefusal(future, 422, 'AS_OF_IN_FUTURE');
  });

  it('drafts, posts and reverses an opening balance at a branch', async () => {
    const token = await signIn('plant');
    const [silom] = json(await call('GET', '/api/v1/locations?type=branch', { token })).filter(
      (l: { code: string }) => l.code === 'BR-SILOM',
    );
    const items = json(await call('GET', '/api/v1/items', { token }));
    const wing = items.find((i: { code: string }) => i.code === 'CHICKEN-WING');
    const draft = json(
      await call('POST', '/api/v1/opening-balances', {
        token,
        body: {
          locationId: silom.id,
          note: '',
          lines: [
            {
              itemId: wing.id,
              quantity: '40',
              secondaryQuantity: null,
              unitCost: '12.50',
              expiryDate: '2026-09-29',
            },
          ],
        },
      }),
    );
    expect(draft).toMatchObject({
      number: 'OB-2026-00002',
      status: 'draft',
      businessDate: '2026-09-26',
      note: null,
      totalValue: '500',
      lines: [{ quantity: '40', unitCost: '12.5', value: '500', lot: null }],
    });

    const post = (revision: number) =>
      call('POST', `/api/v1/opening-balances/${draft.id}/post`, { token, body: { revision } });
    expectRefusal(await post(draft.revision + 1), 409, 'POSTING_REFUSED');
    const posted = json(await post(draft.revision));
    expect(posted).toMatchObject({
      status: 'posted',
      lines: [{ lot: { number: 'OB-2026-00002/1' } }],
    });

    const atSilom = () =>
      call('GET', `/api/v1/stock-on-hand?locationId=${silom.id}`, { token }).then(json);
    expect((await atSilom()).totalValue).toBe('500');

    const reverse = () =>
      call('POST', `/api/v1/opening-balances/${draft.id}/reverse`, {
        token,
        body: { note: 'Counted twice' },
      });
    const reversed = json(await reverse());
    expect(reversed.reversedBy).toMatchObject({ number: 'RV-2026-00001', note: 'Counted twice' });
    expect((await atSilom()).rows).toEqual([]);
    const again = await reverse();
    expectRefusal(again, 409, 'POSTING_REFUSED');
    expect(json(again).details).toEqual({ rule: 'already_reversed' });
  });

  it('refuses what the API refuses on an opening balance', async () => {
    const token = await signIn('plant');
    const locations = json(await call('GET', '/api/v1/locations?status=all', { token }));
    const plant = locations.find((l: { code: string }) => l.code === 'PLANT-01');
    const inTransit = locations.find((l: { type: string }) => l.type === 'in_transit');
    const flour = json(await call('GET', '/api/v1/items', { token })).find(
      (i: { code: string }) => i.code === 'FLOUR',
    );
    const line = {
      itemId: flour.id,
      quantity: '10',
      secondaryQuantity: null,
      unitCost: '32.5',
      expiryDate: '2026-12-31',
    };
    const create = (body: object) => call('POST', '/api/v1/opening-balances', { token, body });

    const transit = await create({ locationId: inTransit.id, lines: [line] });
    expectRefusal(transit, 422, 'LOCATION_NOT_ALLOWED');
    const precise = await create({
      locationId: plant.id,
      lines: [{ ...line, quantity: '1.0001' }],
    });
    expectRefusal(precise, 422, 'INVALID_OPENING_BALANCE_LINE');
    expect(json(precise).details).toEqual({ lineNo: 1, problem: 'QUANTITY_TOO_PRECISE' });
    const unknownField = await create({ locationId: plant.id, lines: [], colour: 'red' });
    expectRefusal(unknownField, 400, 'VALIDATION_FAILED');

    const expired = json(
      await create({
        locationId: plant.id,
        businessDate: '2026-09-20',
        lines: [{ ...line, expiryDate: '2026-09-19' }],
      }),
    );
    const post = await call('POST', `/api/v1/opening-balances/${expired.id}/post`, {
      token,
      body: { revision: expired.revision },
    });
    expectRefusal(post, 422, 'POSTING_REFUSED');
    expect(json(post).details).toEqual({ rule: 'expired_lot', lineNo: 1 });

    const edit = await call('PATCH', `/api/v1/opening-balances/${expired.id}`, {
      token,
      body: { revision: expired.revision, businessDate: '2026-09-27' },
    });
    expectRefusal(edit, 422, 'BUSINESS_DATE_IN_FUTURE');
  });
});

describe('the demo API: stock adjustments', () => {
  it("shows the seed's approved write-off, and leaves raising one to a real installation", async () => {
    const token = await signIn('plant');
    const list = json(await call('GET', '/api/v1/stock-adjustments', { token }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      number: 'AD-2026-00001',
      type: 'stock_adjustment',
      status: 'posted',
      lineCount: 1,
      totalValue: '-130.5',
      createdBy: { displayName: 'Demo plant' },
      postedBy: { displayName: 'Demo finance' },
    });
    const one = json(await call('GET', `/api/v1/stock-adjustments/${list[0].id}`, { token }));
    expect(one).toMatchObject({
      approved: { by: { displayName: 'Demo finance' } },
      rejected: null,
      lines: [
        {
          lot: { number: `OB-2026-00001/${DEMO_WRITE_OFF.openingBalanceLineNo}` },
          quantity: DEMO_WRITE_OFF.quantity,
          secondaryQuantity: DEMO_WRITE_OFF.secondaryQuantity,
          reason: DEMO_WRITE_OFF.reason,
          value: '-130.5',
        },
      ],
    });
    const raise = await call('POST', '/api/v1/stock-adjustments', {
      token,
      body: { locationId: one.location.id, lines: [] },
    });
    expectRefusal(raise, 404, 'NOT_IN_DEMO');
  });
});

describe('the demo API: the menu (#16)', () => {
  it('serves the demo menu to finance, with Silom’s own bucket price', async () => {
    const token = await signIn('finance');
    const menu = json(await call('GET', '/api/v1/menu-items?status=all', { token }));
    expect(menu.map((m: { code: string }) => m.code)).toEqual(DEMO_MENU_ITEMS.map((m) => m.code));
    const bucket = menu.find((m: { code: string }) => m.code === 'BUCKET-8');
    expect(bucket).toMatchObject({ currentPrice: '299', soldBy: 'portion' });
    const detail = json(await call('GET', `/api/v1/menu-items/${bucket.id}`, { token }));
    expect(
      detail.prices.map(
        (p: { location: { code: string } | null; price: string | null; status: string }) => [
          p.location?.code ?? null,
          p.price,
          p.status,
        ],
      ),
    ).toEqual([
      ['BR-SILOM', null, 'scheduled'],
      [null, '309', 'scheduled'],
      [null, '299', 'current'],
      ['BR-SILOM', '319', 'current'],
    ]);
  });

  it('prices a recipe at the demo’s current lot costs with the backend’s own rule', async () => {
    const token = await signIn('finance');
    const menu = json(await call('GET', '/api/v1/menu-items', { token }));
    const byWeight = menu.find((m: { code: string }) => m.code === 'FRIED-CHICKEN-BY-WEIGHT');
    const recipe = json(await call('GET', `/api/v1/menu-items/${byWeight.id}/recipe`, { token }));
    expect(recipe.subject).toMatchObject({ kind: 'menu', per: 'kg' });
    const [current] = recipe.versions;
    // The whole-chicken lot that expires first (72.5 baht/kg), flour (32.5) and oil (48).
    expect(
      current.lines.map((l: { item: { code: string }; cost: string }) => [l.item.code, l.cost]),
    ).toEqual([
      ['WHOLE-CHICKEN', '90.625'],
      ['FLOUR', '4.875'],
      ['FRYING-OIL', '3.84'],
    ]);
    expect(current.theoreticalCost).toEqual({ total: '99.34', complete: true });

    const groups = json(await call('GET', '/api/v1/modifier-groups', { token }));
    const noSauce = groups
      .flatMap((g: { options: Array<{ id: string; code: string }> }) => g.options)
      .find((o: { code: string }) => o.code === 'NO-SAUCE');
    const option = json(
      await call('GET', `/api/v1/modifier-options/${noSauce.id}/recipe`, { token }),
    );
    expect(option.versions[0].lines[0]).toMatchObject({ quantity: '-1', unitCost: null });
    expect(DEMO_MODIFIER_GROUPS.map((g) => g.code)).toEqual(
      groups.map((g: { code: string }) => g.code),
    );
  });

  it('keeps the menu from roles that may not read it, and changing it is not in the demo', async () => {
    const purchasing = await signIn('purchasing');
    expectRefusal(
      await call('GET', '/api/v1/menu-items', { token: purchasing }),
      403,
      'ACCESS_DENIED',
    );
    const admin = await signIn('admin');
    const create = await call('POST', '/api/v1/menu-items', { token: admin, body: {} });
    expectRefusal(create, 404, 'NOT_IN_DEMO');
  });
});

describe('the demo API: production BOMs (#12)', () => {
  it('shows the cutting BOM with the same weights, yield and ratios the backend stores', async () => {
    const token = await signIn('plant');
    const list = json(await call('GET', '/api/v1/production-boms', { token }));
    expect(list.map((b: { code: string }) => b.code)).toEqual(['CUT-WHOLE-CHICKEN', 'MIX-BATTER']);
    expect(list[0].current).toEqual({
      number: 1,
      effectiveFrom: '2026-09-25',
      yieldPercent: '90.00',
    });

    const cut = json(await call('GET', `/api/v1/production-boms/${list[0].id}`, { token }));
    const [version] = cut.versions;
    expect(version).toMatchObject({
      status: 'current',
      ratiosOverridden: true,
      wasteKg: '2.000',
      yieldPercent: '90.00',
    });
    expect(version.outputs.map((o: { allocationRatio: string }) => o.allocationRatio)).toEqual([
      '35.00',
      '22.00',
      '18.00',
      '17.00',
      '8.00',
    ]);
  });

  it('previews a version for the admin, and refuses to save one', async () => {
    const token = await signIn('admin');
    const items = json(await call('GET', '/api/v1/items', { token }));
    const id = (code: string) => items.find((i: { code: string }) => i.code === code).id;
    const preview = json(
      await call('POST', '/api/v1/production-boms/preview', {
        token,
        body: {
          inputs: [{ itemId: id('FLOUR'), quantity: '25' }],
          outputs: [{ itemId: id('BATTER-MIX'), quantity: '24.5' }],
        },
      }),
    );
    expect(preview.figures).toMatchObject({ wasteKg: '0.500', yieldPercent: '98.00' });
    expect(preview.figures.outputs[0].defaultRatio).toBe('100.00');

    expectRefusal(
      await call('POST', '/api/v1/production-boms', { token, body: {} }),
      404,
      'NOT_IN_DEMO',
    );
    const plant = await signIn('plant');
    expectRefusal(
      await call('POST', '/api/v1/production-boms/preview', { token: plant, body: {} }),
      403,
      'ACCESS_DENIED',
    );
  });
});

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import {
  ADMIN,
  axeViolations,
  jsonResponse,
  MENU_READER,
  mockApi,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import type { ItemView, UnitView } from '@/features/items/items.api';
import type { MenuItemDetailView, ModifierGroupView, RecipeView } from './menu.api';

const UNITS: UnitView[] = [
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'l', nameTh: 'ลิตร', nameEn: 'litre', decimals: 3 },
  { code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 },
];

const ingredient = (id: string, code: string, nameTh: string, baseUnitCode: string): ItemView => ({
  id,
  code,
  nameTh,
  nameEn: code,
  baseUnitCode,
  variableWeight: false,
  shelfLifeDays: 30,
  receivingTolerances: { maxVariancePercent: null, maxTemperature: null },
  requisitionUnit: null,
  active: true,
  purchaseUnits: [],
  version: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
});
const FLOUR = ingredient('00000000-0000-4000-8000-0000000000f1', 'FLOUR', 'แป้งชุบทอด', 'kg');
const DRUMSTICK = ingredient(
  '00000000-0000-4000-8000-0000000000f2',
  'CHICKEN-DRUMSTICK',
  'น่องไก่',
  'piece',
);

const SAUCE: ModifierGroupView = {
  id: '00000000-0000-4000-8000-0000000000a1',
  code: 'SAUCE',
  nameTh: 'น้ำจิ้ม',
  nameEn: 'Sauce',
  minSelections: 0,
  maxSelections: 1,
  active: true,
  options: [],
  version: 3,
};

const SET: MenuItemDetailView = {
  id: '00000000-0000-4000-8000-0000000000b1',
  code: 'SET-2PC',
  nameTh: 'ชุดไก่ทอด 2 ชิ้น',
  nameEn: 'Two-piece set',
  categoryTh: 'ชุด',
  categoryEn: 'Sets',
  soldBy: 'portion',
  active: true,
  modifierGroups: [{ id: SAUCE.id, code: 'SAUCE', nameTh: 'น้ำจิ้ม', nameEn: 'Sauce' }],
  currentPrice: '79',
  version: 12,
  prices: [
    {
      id: '00000000-0000-4000-8000-0000000000c2',
      location: null,
      effectiveFrom: '2026-10-09',
      price: '85',
      status: 'scheduled',
      version: 20,
    },
    {
      id: '00000000-0000-4000-8000-0000000000c1',
      location: null,
      effectiveFrom: '2026-10-01',
      price: '79',
      status: 'current',
      version: 13,
    },
  ],
};

const BY_WEIGHT: MenuItemDetailView = {
  ...SET,
  id: '00000000-0000-4000-8000-0000000000b2',
  code: 'FRIED-CHICKEN-BY-WEIGHT',
  nameTh: 'ไก่ทอดชั่งกิโล',
  nameEn: 'Fried chicken by weight',
  categoryTh: 'ขายตามน้ำหนัก',
  categoryEn: 'By weight',
  soldBy: 'weight',
  modifierGroups: [],
  currentPrice: '320',
  prices: [],
};

const RECIPE: RecipeView = {
  subject: {
    kind: 'menu',
    id: SET.id,
    code: SET.code,
    nameTh: SET.nameTh,
    nameEn: SET.nameEn,
    per: 'portion',
  },
  today: '2026-10-02',
  versions: [
    {
      id: '00000000-0000-4000-8000-0000000000d1',
      number: 1,
      effectiveFrom: '2026-10-01',
      status: 'current',
      lines: [
        {
          lineNo: 1,
          item: { ...DRUMSTICK },
          quantity: '1',
          unitCost: null,
          costLot: null,
          cost: null,
        },
        {
          lineNo: 2,
          item: { ...FLOUR },
          quantity: '0.06',
          unitCost: '32.5',
          costLot: 'OB-2026-00001/1',
          cost: '1.95',
        },
      ],
      theoreticalCost: { total: '1.95', complete: false },
      version: 14,
    },
  ],
};

const listOf = (...items: MenuItemDetailView[]) =>
  items.map(({ prices: _prices, ...item }) => item);

const api = (overrides: Record<string, () => Response> = {}) => ({
  'GET /menu-items': () => jsonResponse(200, listOf(SET, BY_WEIGHT)),
  [`GET /menu-items/${SET.id}`]: () => jsonResponse(200, SET),
  [`GET /menu-items/${SET.id}/recipe`]: () => jsonResponse(200, RECIPE),
  'GET /modifier-groups': () => jsonResponse(200, [SAUCE]),
  'GET /items': () => jsonResponse(200, [FLOUR, DRUMSTICK]),
  'GET /units': () => jsonResponse(200, UNITS),
  'GET /locations': () => jsonResponse(200, []),
  ...overrides,
});

describe('menu and prices (#16)', () => {
  it('lists menu items with today’s price, per kilogram when sold by weight', async () => {
    mockApi(api());
    renderApp('/menu', { as: MENU_READER });

    expect(await screen.findByRole('heading', { level: 1, name: 'เมนูและราคา' })).toBeVisible();
    const set = (await screen.findByRole('rowheader', { name: /ชุดไก่ทอด 2 ชิ้น/ })).closest('tr')!;
    expect(within(set).getByText('79 บาท')).toBeVisible();
    expect(within(set).getByText('น้ำจิ้ม')).toBeVisible();
    const weighed = screen.getByRole('rowheader', { name: /ไก่ทอดชั่งกิโล/ }).closest('tr')!;
    expect(within(weighed).getByText('320 บาท/กก.')).toBeVisible();
    expect(within(weighed).getByText('ขายตามน้ำหนัก', { selector: '.badge' })).toBeVisible();
    // Readers see no button that changes the menu.
    expect(screen.queryByRole('button', { name: 'เพิ่มรายการเมนู' })).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it('opens one with its prices and a recipe priced at current lot costs, labelled an estimate', async () => {
    mockApi(api());
    renderApp('/menu', { as: MENU_READER });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด ชุดไก่ทอด 2 ชิ้น' }));
    const prices = await screen.findByRole('table', { name: 'ราคาของรายการเมนูนี้' });
    expect(
      within(prices)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual([
      'ใช้ที่เริ่มมีผลราคาสถานะ',
      'ราคากลางทุกสาขา9 ต.ค. 256985 บาทตั้งไว้ล่วงหน้า',
      'ราคากลางทุกสาขา1 ต.ค. 256979 บาทมีผลอยู่',
    ]);
    expect(await screen.findByText('เวอร์ชัน 1 · เริ่ม 1 ต.ค. 2569')).toBeVisible();
    expect(screen.getByText('ไม่มี lot ที่ใช้ได้')).toBeVisible();
    expect(
      screen.getByText(
        'ต้นทุนตามทฤษฎีอย่างน้อย 1.95 บาท (ประมาณการ บางวัตถุดิบไม่มี lot ให้คิดต้นทุน)',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ตั้งราคา' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'เพิ่มเวอร์ชันสูตร' })).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it('lets the admin set a price from a date typed the Thai way, sent as ISO', async () => {
    const fetchMock = mockApi(
      api({
        [`POST /menu-items/${SET.id}/prices`]: () =>
          jsonResponse(201, {
            ...SET,
            prices: [
              {
                id: '00000000-0000-4000-8000-0000000000c3',
                location: null,
                effectiveFrom: '2026-10-15',
                price: '89',
                status: 'scheduled',
                version: 30,
              },
              ...SET.prices,
            ],
          }),
      }),
    );
    renderApp('/menu', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด ชุดไก่ทอด 2 ชิ้น' }));
    await u.type(await screen.findByLabelText('เริ่มมีผลวันที่'), '15/10/2569');
    await u.type(screen.getByLabelText('ราคา (บาท)'), '89');
    await u.click(screen.getByRole('button', { name: 'ตั้งราคา' }));

    expect(await screen.findByText('89 บาท')).toBeVisible();
    const post = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, post)).toEqual({
      locationId: null,
      effectiveFrom: '2026-10-15',
      price: '89',
    });
  });

  it('lets the admin send a branch back to the chain price, and shows the return in the history', async () => {
    const SILOM = {
      id: '00000000-0000-4000-8000-0000000000d1',
      code: 'BR-SILOM',
      type: 'branch',
      nameTh: 'สาขาสีลม',
      nameEn: 'Silom',
      active: true,
    };
    const fetchMock = mockApi(
      api({
        'GET /locations': () => jsonResponse(200, [SILOM]),
        [`POST /menu-items/${SET.id}/prices`]: () =>
          jsonResponse(201, {
            ...SET,
            prices: [
              {
                id: '00000000-0000-4000-8000-0000000000c4',
                location: {
                  id: SILOM.id,
                  code: SILOM.code,
                  nameTh: SILOM.nameTh,
                  nameEn: SILOM.nameEn,
                },
                effectiveFrom: '2026-10-20',
                price: null,
                status: 'scheduled',
                version: 31,
              },
              ...SET.prices,
            ],
          }),
      }),
    );
    renderApp('/menu', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด ชุดไก่ทอด 2 ชิ้น' }));
    // Only a branch can return to the chain price: no such choice for the chain-wide price.
    expect(screen.queryByLabelText(/กลับไปใช้ราคากลาง|คิดราคากลาง/)).toBeNull();
    await u.selectOptions(await screen.findByLabelText('ใช้ที่'), 'BR-SILOM · สาขาสีลม');
    await u.click(screen.getByLabelText('เลิกใช้ราคาของสาขานี้ คิดราคากลางตั้งแต่วันที่เริ่มมีผล'));
    expect(screen.queryByLabelText('ราคา (บาท)')).toBeNull();
    await u.type(screen.getByLabelText('เริ่มมีผลวันที่'), '20/10/2569');
    expect(await axeViolations()).toEqual([]);
    await u.click(screen.getByRole('button', { name: 'ตั้งราคา' }));

    const prices = await screen.findByRole('table', { name: 'ราคาของรายการเมนูนี้' });
    expect(await within(prices).findByText('กลับไปใช้ราคากลาง')).toBeVisible();
    const post = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, post)).toEqual({
      locationId: SILOM.id,
      effectiveFrom: '2026-10-20',
      price: null,
    });
  });

  it('says from which day a refused recipe version could start, in the console’s calendar', async () => {
    mockApi(
      api({
        [`POST /menu-items/${SET.id}/recipe-versions`]: () =>
          jsonResponse(422, {
            statusCode: 422,
            code: 'RECIPE_TOO_EARLY',
            message: 'too early',
            details: { field: 'effectiveFrom', earliest: '2026-10-03' },
          }),
      }),
    );
    renderApp('/menu', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด ชุดไก่ทอด 2 ชิ้น' }));
    await u.click(await screen.findByRole('button', { name: 'เพิ่มเวอร์ชันสูตร' }));
    const form = screen.getByRole('form', { name: 'เวอร์ชันสูตรใหม่' });
    await u.type(within(form).getByLabelText('เริ่มมีผลวันที่'), '2/10/2569');
    await u.selectOptions(
      within(form).getByLabelText('วัตถุดิบ (บรรทัดที่ 1)'),
      'FLOUR · แป้งชุบทอด',
    );
    await u.type(within(form).getByLabelText('ปริมาณเป็นกิโลกรัม (บรรทัดที่ 1)'), '0.05');
    expect(await axeViolations()).toEqual([]);
    await u.click(within(form).getByRole('button', { name: 'บันทึกเวอร์ชันใหม่' }));

    expect(
      await within(form).findByText(
        'เวอร์ชันใหม่เริ่มได้เร็วสุด 3 ต.ค. 2569 สูตรไม่เปลี่ยนกลางวันที่เริ่มไปแล้ว',
      ),
    ).toBeVisible();
  });

  it('creates a menu item with its modifier groups', async () => {
    const created: MenuItemDetailView = {
      ...SET,
      id: '00000000-0000-4000-8000-0000000000b9',
      code: 'POPCORN',
      prices: [],
    };
    const fetchMock = mockApi(
      api({
        'POST /menu-items': () => jsonResponse(201, created),
        [`GET /menu-items/${created.id}`]: () => jsonResponse(200, created),
        [`GET /menu-items/${created.id}/recipe`]: () =>
          jsonResponse(200, {
            ...RECIPE,
            subject: { ...RECIPE.subject, id: created.id },
            versions: [],
          }),
      }),
    );
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/menu', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'Add menu item' }));
    const form = screen.getByRole('form', { name: 'New menu item' });
    await u.type(within(form).getByLabelText('Menu item code'), 'popcorn');
    await u.type(within(form).getByLabelText('Name in Thai'), 'ไก่ป๊อป');
    await u.type(within(form).getByLabelText('Name in English'), 'Popcorn chicken');
    await u.type(within(form).getByLabelText('Category in Thai'), 'ของทานเล่น');
    await u.type(within(form).getByLabelText('Category in English'), 'Snacks');
    await u.click(within(form).getByLabelText('Sold by weight'));
    await u.click(within(form).getByLabelText(/Sauce/));
    expect(await axeViolations()).toEqual([]);
    await u.click(within(form).getByRole('button', { name: 'Create menu item' }));

    expect(
      await screen.findByText('Created menu item POPCORN. Set its price and recipe next.'),
    ).toBeVisible();
    const post = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, post)).toEqual({
      code: 'POPCORN',
      nameTh: 'ไก่ป๊อป',
      nameEn: 'Popcorn chicken',
      categoryTh: 'ของทานเล่น',
      categoryEn: 'Snacks',
      soldBy: 'weight',
      modifierGroupIds: [SAUCE.id],
    });
  });

  it('is not in the navigation of someone who may not read the menu', async () => {
    mockApi({
      'GET /health': () => jsonResponse(200, { status: 'ok', api: 'up', database: 'up' }),
    });
    renderApp('/', { as: STAFF });
    await screen.findByRole('heading', { level: 1, name: 'สถานะระบบ' });
    expect(screen.queryByRole('link', { name: 'เมนูและราคา' })).toBeNull();
  });
});

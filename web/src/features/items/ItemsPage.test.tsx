// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import {
  ADMIN,
  axeViolations,
  jsonResponse,
  mockApi,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import type { ItemView, UnitView } from './items.api';

const UNITS: UnitView[] = [
  { code: 'bag', nameTh: 'ถุง', nameEn: 'bag', decimals: 0 },
  { code: 'case', nameTh: 'ลัง', nameEn: 'case', decimals: 0 },
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 },
];

const item = (overrides: Partial<ItemView>): ItemView => ({
  id: '00000000-0000-4000-8000-000000000000',
  code: 'ITEM',
  nameTh: 'สินค้า',
  nameEn: 'Item',
  baseUnitCode: 'kg',
  variableWeight: false,
  shelfLifeDays: 5,
  active: true,
  purchaseUnits: [],
  version: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  ...overrides,
});

const WHOLE = item({
  id: '00000000-0000-4000-8000-00000000000a',
  code: 'WHOLE-CHICKEN',
  nameTh: 'ไก่ทั้งตัว',
  nameEn: 'Whole chicken',
  variableWeight: true,
  purchaseUnits: [{ unitCode: 'case', factor: '20' }],
  version: 3,
});
const WING = item({
  id: '00000000-0000-4000-8000-00000000000b',
  code: 'CHICKEN-WING',
  nameTh: 'ปีกไก่',
  nameEn: 'Chicken wing',
  baseUnitCode: 'piece',
  shelfLifeDays: 1,
  version: 4,
});
const OLD = item({
  id: '00000000-0000-4000-8000-00000000000c',
  code: 'OLD-SAUCE',
  nameTh: 'ซอสสูตรเก่า',
  nameEn: 'Old sauce',
  active: false,
});

const rowOf = (name: string) => {
  const row = screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
};

const catalogue = (items: () => ItemView[]) => ({
  'GET /items': () => jsonResponse(200, items()),
  'GET /units': () => jsonResponse(200, UNITS),
});

describe('items and units', () => {
  it('lists active items with their units, conversions and shelf life, and passes axe in both languages', async () => {
    const api = mockApi(catalogue(() => [WHOLE, WING, OLD]));
    const view = renderApp('/items', { as: STAFF });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'สินค้าและหน่วยนับ' }),
    ).toBeVisible();
    await screen.findByText('ไก่ทั้งตัว');
    expect(rowOf('ไก่ทั้งตัว').getByText('WHOLE-CHICKEN')).toBeVisible();
    expect(rowOf('ไก่ทั้งตัว').getByText('น้ำหนักแปรผัน')).toBeVisible();
    expect(rowOf('ไก่ทั้งตัว').getByText('1 ลัง = 20 กิโลกรัม')).toBeVisible();
    expect(rowOf('ไก่ทั้งตัว').getByText('5 วัน')).toBeVisible();
    expect(rowOf('ปีกไก่').getByText('ชิ้น')).toBeVisible();
    expect(rowOf('ปีกไก่').getByText('ไม่มี')).toBeVisible();
    expect(rowOf('ปีกไก่').getByText('1 วัน')).toBeVisible();
    // Inactive items are kept, but not shown until asked for.
    expect(screen.queryByText('ซอสสูตรเก่า')).not.toBeInTheDocument();
    // Every item, active or not, in one request: the list filters on screen.
    expect(String(api.mock.calls[0][0])).toMatch(/\/items\?status=all$/);
    expect(await axeViolations()).toEqual([]);

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/items', { as: STAFF });
    await screen.findByText('Whole chicken');
    expect(rowOf('Whole chicken').getByText('1 case = 20 kilogram')).toBeVisible();
    expect(rowOf('Chicken wing').getByText('1 day')).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('is open to anyone signed in, but only item:manage sees the buttons that change items', async () => {
    mockApi(catalogue(() => [WHOLE]));
    renderApp('/items', { as: STAFF });

    const nav = screen.getByRole('navigation', { name: 'เมนูหลัก' });
    expect(within(nav).getByRole('link', { name: 'สินค้าและหน่วยนับ' })).toBeVisible();
    await screen.findByText('ไก่ทั้งตัว');
    expect(screen.queryByRole('button', { name: 'เพิ่มสินค้า' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /แก้ไข/ })).not.toBeInTheDocument();
  });

  it('searches by code or either name, and shows inactive items on request', async () => {
    mockApi(catalogue(() => [WHOLE, WING, OLD]));
    renderApp('/items', { as: STAFF });
    const u = userEvent.setup();
    await screen.findByText('ไก่ทั้งตัว');

    await u.type(screen.getByLabelText('ค้นหาจากรหัสหรือชื่อ'), 'wing');
    expect(screen.getByText('ปีกไก่')).toBeVisible();
    expect(screen.queryByText('ไก่ทั้งตัว')).not.toBeInTheDocument();
    expect(screen.getByText('1 รายการ')).toBeVisible();

    await u.clear(screen.getByLabelText('ค้นหาจากรหัสหรือชื่อ'));
    await u.selectOptions(screen.getByLabelText('แสดง'), 'inactive');
    expect(rowOf('ซอสสูตรเก่า').getByText('ปิดใช้งาน')).toBeVisible();
    expect(screen.queryByText('ปีกไก่')).not.toBeInTheDocument();

    await u.type(screen.getByLabelText('ค้นหาจากรหัสหรือชื่อ'), 'no such thing');
    expect(screen.getByText('ไม่พบสินค้าที่ตรงกับเงื่อนไขนี้')).toBeVisible();
  });

  it('creates an item with purchase units, previewing each conversion', async () => {
    let created: ItemView | null = null;
    const api = mockApi({
      ...catalogue(() => (created ? [WHOLE, created] : [WHOLE])),
      'POST /items': (init) => {
        const body = JSON.parse(String(init.body)) as ItemView;
        created = item({ ...body, id: '00000000-0000-4000-8000-00000000000d', version: 9 });
        return jsonResponse(201, created);
      },
    });
    renderApp('/items', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เพิ่มสินค้า' }));
    const form = screen.getByRole('form', { name: 'สินค้าใหม่' });
    expect(within(form).getByRole('heading', { name: 'สินค้าใหม่' })).toHaveFocus();

    await u.type(within(form).getByLabelText('รหัสสินค้า'), 'flour-batter');
    expect(within(form).getByLabelText('รหัสสินค้า')).toHaveValue('FLOUR-BATTER');
    await u.selectOptions(within(form).getByLabelText('หน่วยหลัก'), 'kg');
    await u.type(within(form).getByLabelText('ชื่อภาษาไทย'), 'แป้งชุบทอด');
    await u.type(within(form).getByLabelText('ชื่อภาษาอังกฤษ'), 'Batter flour');
    await u.type(within(form).getByLabelText('อายุการเก็บ (วัน)'), '180');
    await u.click(within(form).getByRole('button', { name: 'เพิ่มหน่วยซื้อ' }));
    await u.selectOptions(within(form).getByLabelText('หน่วยซื้อแถวที่ 1'), 'bag');
    await u.type(within(form).getByLabelText('กิโลกรัม ต่อ 1 หน่วยซื้อ (แถวที่ 1)'), '22.50');
    expect(within(form).getByText('1 ถุง = 22.5 กิโลกรัม')).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);

    await u.click(within(form).getByRole('button', { name: 'สร้างสินค้า' }));

    expect(await screen.findByText('สร้างสินค้า FLOUR-BATTER แล้ว')).toBeVisible();
    const post = api.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(api, post)).toEqual({
      code: 'FLOUR-BATTER',
      baseUnitCode: 'kg',
      nameTh: 'แป้งชุบทอด',
      nameEn: 'Batter flour',
      variableWeight: false,
      shelfLifeDays: 180,
      // The factor travels as the exact string typed, never as a binary float.
      purchaseUnits: [{ unitCode: 'bag', factor: '22.50' }],
    });
    expect(await screen.findByText('แป้งชุบทอด')).toBeVisible();
    expect(screen.queryByRole('form', { name: 'สินค้าใหม่' })).not.toBeInTheDocument();
  });

  it('marks each purchase unit row the API refuses, and why', async () => {
    mockApi({
      ...catalogue(() => [WHOLE]),
      'POST /items': () =>
        jsonResponse(422, {
          code: 'INVALID_PURCHASE_UNITS',
          message: 'x',
          details: {
            issues: [
              { index: 0, unitCode: 'case', problem: 'NOT_POSITIVE' },
              { index: 1, unitCode: 'kg', problem: 'SAME_AS_BASE_UNIT' },
            ],
          },
        }),
    });
    renderApp('/items', { as: ADMIN });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'เพิ่มสินค้า' }));
    const form = screen.getByRole('form', { name: 'สินค้าใหม่' });
    await u.type(within(form).getByLabelText('รหัสสินค้า'), 'X1');
    await u.selectOptions(within(form).getByLabelText('หน่วยหลัก'), 'kg');
    await u.type(within(form).getByLabelText('ชื่อภาษาไทย'), 'x');
    await u.type(within(form).getByLabelText('ชื่อภาษาอังกฤษ'), 'x');
    await u.type(within(form).getByLabelText('อายุการเก็บ (วัน)'), '3');
    for (const [n, unit, factor] of [
      [1, 'case', '0'],
      [2, 'kg', '1'],
    ] as const) {
      await u.click(within(form).getByRole('button', { name: 'เพิ่มหน่วยซื้อ' }));
      await u.selectOptions(within(form).getByLabelText(`หน่วยซื้อแถวที่ ${n}`), unit);
      await u.type(within(form).getByLabelText(`กิโลกรัม ต่อ 1 หน่วยซื้อ (แถวที่ ${n})`), factor);
    }
    await u.click(within(form).getByRole('button', { name: 'สร้างสินค้า' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'หน่วยซื้อบางแถวไม่ถูกต้อง ดูรายละเอียดที่แต่ละแถว',
    );
    const first = within(form).getByLabelText('กิโลกรัม ต่อ 1 หน่วยซื้อ (แถวที่ 1)');
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(first).toHaveAccessibleDescription('ต้องมากกว่าศูนย์');
    expect(within(form).getByLabelText('หน่วยซื้อแถวที่ 2')).toHaveAccessibleDescription(
      'ต้องไม่ใช่หน่วยเดียวกับหน่วยหลัก',
    );
    expect(await axeViolations()).toEqual([]);
  });

  it('edits an item from the version it was opened at; code and base unit stay fixed', async () => {
    let current = WHOLE;
    const api = mockApi({
      ...catalogue(() => [current]),
      'PATCH /items/00000000-0000-4000-8000-00000000000a': (init) => {
        const body = JSON.parse(String(init.body)) as Partial<ItemView>;
        current = { ...current, ...body, version: 10 };
        return jsonResponse(200, current);
      },
    });
    renderApp('/items', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'แก้ไข ไก่ทั้งตัว' }));
    const form = screen.getByRole('form', { name: 'แก้ไขสินค้า WHOLE-CHICKEN' });
    expect(within(form).queryByLabelText('รหัสสินค้า')).not.toBeInTheDocument();
    expect(within(form).queryByLabelText('หน่วยหลัก')).not.toBeInTheDocument();
    expect(within(form).getByLabelText('สินค้าน้ำหนักแปรผัน')).toBeChecked();

    const factor = within(form).getByLabelText('กิโลกรัม ต่อ 1 หน่วยซื้อ (แถวที่ 1)');
    await u.clear(factor);
    await u.type(factor, '18');
    await u.clear(within(form).getByLabelText('อายุการเก็บ (วัน)'));
    await u.type(within(form).getByLabelText('อายุการเก็บ (วัน)'), '4');
    await u.click(within(form).getByRole('button', { name: 'บันทึกการแก้ไข' }));

    expect(await screen.findByText('บันทึกสินค้า WHOLE-CHICKEN แล้ว')).toBeVisible();
    const patch = api.mock.calls.findIndex(([, init]) => init?.method === 'PATCH');
    expect(sentBody(api, patch)).toEqual({
      version: 3,
      nameTh: 'ไก่ทั้งตัว',
      nameEn: 'Whole chicken',
      variableWeight: true,
      shelfLifeDays: 4,
      purchaseUnits: [{ unitCode: 'case', factor: '18' }],
    });
    expect(await screen.findByText('1 ลัง = 18 กิโลกรัม')).toBeVisible();
  });

  it('says so when someone else changed the item first', async () => {
    mockApi({
      ...catalogue(() => [WHOLE]),
      'PATCH /items/00000000-0000-4000-8000-00000000000a': () =>
        jsonResponse(409, { code: 'ITEM_CHANGED', message: 'x', details: { currentVersion: 5 } }),
    });
    renderApp('/items', { as: ADMIN });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'แก้ไข ไก่ทั้งตัว' }));
    await u.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'มีคนแก้ไขสินค้านี้หลังจากที่คุณเปิดขึ้นมา',
    );
  });

  it('deactivates an item instead of deleting it, and can bring it back', async () => {
    let current = WING;
    const api = mockApi({
      ...catalogue(() => [current]),
      'PATCH /items/00000000-0000-4000-8000-00000000000b': (init) => {
        const body = JSON.parse(String(init.body)) as { active: boolean };
        current = { ...current, active: body.active, version: current.version + 1 };
        return jsonResponse(200, current);
      },
    });
    renderApp('/items', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'แก้ไข ปีกไก่' }));
    const deactivate = screen.getByRole('button', { name: 'ปิดใช้งานสินค้านี้' });
    expect(deactivate).toHaveAccessibleDescription(
      'สินค้าจะไม่ถูกลบ ประวัติทั้งหมดยังอยู่ครบ และเปิดใช้งานอีกครั้งได้ทุกเมื่อ',
    );
    await u.click(deactivate);

    expect(await screen.findByText('ปิดใช้งาน CHICKEN-WING แล้ว')).toBeVisible();
    const patch = api.mock.calls.findIndex(([, init]) => init?.method === 'PATCH');
    expect(sentBody(api, patch)).toEqual({ version: 4, active: false });

    await u.selectOptions(screen.getByLabelText('แสดง'), 'all');
    await u.click(await screen.findByRole('button', { name: 'แก้ไข ปีกไก่' }));
    await u.click(screen.getByRole('button', { name: 'เปิดใช้งานอีกครั้ง' }));
    expect(await screen.findByText('เปิดใช้งาน CHICKEN-WING อีกครั้งแล้ว')).toBeVisible();
  });
});

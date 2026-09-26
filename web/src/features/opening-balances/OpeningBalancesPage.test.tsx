// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import {
  axeViolations,
  jsonResponse,
  mockApi,
  PLANT,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import type { ItemView } from '@/features/items/items.api';
import type { OpeningBalanceLine, OpeningBalanceView } from './opening-balances.api';

const UNITS = [
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 },
];
const PLANT_SITE = {
  id: '00000000-0000-4000-8000-0000000000a1',
  code: 'PLANT-01',
  type: 'plant' as const,
  nameTh: 'โรงงานบางนา',
  nameEn: 'Bang Na plant',
  active: true,
};
const IN_TRANSIT = {
  ...PLANT_SITE,
  id: '00000000-0000-4000-8000-0000000000a9',
  code: 'IN-TRANSIT:PLANT-01',
  type: 'in_transit' as const,
};

const item = (overrides: Partial<ItemView>): ItemView => ({
  id: '00000000-0000-4000-8000-0000000000b1',
  code: 'WHOLE-CHICKEN',
  nameTh: 'ไก่ทั้งตัว',
  nameEn: 'Whole chicken',
  baseUnitCode: 'kg',
  variableWeight: true,
  shelfLifeDays: 5,
  active: true,
  purchaseUnits: [],
  version: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  ...overrides,
});
const CHICKEN = item({});
const FLOUR = item({
  id: '00000000-0000-4000-8000-0000000000b2',
  code: 'FLOUR',
  nameTh: 'แป้งชุบทอด',
  nameEn: 'Batter flour',
  variableWeight: false,
});

const line = (overrides: Partial<OpeningBalanceLine>): OpeningBalanceLine => ({
  lineNo: 1,
  item: {
    id: CHICKEN.id,
    code: CHICKEN.code,
    nameTh: CHICKEN.nameTh,
    nameEn: CHICKEN.nameEn,
    baseUnitCode: 'kg',
    variableWeight: true,
  },
  quantity: '21.600',
  secondaryQuantity: '12',
  unitCost: '72.5',
  expiryDate: '2026-09-29',
  value: '1566',
  lot: null,
  ...overrides,
});

const PERSON = { id: '6c1d0a52-6d8e-4c52-9a55-3d7f0b3a0004', displayName: 'Demo plant' };
const doc = (overrides: Partial<OpeningBalanceView>): OpeningBalanceView => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  number: 'OB-2026-00001',
  status: 'posted',
  businessDate: '2026-09-25',
  note: null,
  revision: 2,
  createdBy: PERSON,
  createdAt: '2026-09-26T03:00:00.000Z',
  postedBy: PERSON,
  postedAt: '2026-09-26T03:05:00.000Z',
  reversedBy: null,
  location: PLANT_SITE,
  totalValue: '1566',
  lines: [line({ lot: { id: '00000000-0000-4000-8000-0000000000e1', number: 'OB-2026-00001/1' } })],
  ...overrides,
});
const summary = (d: OpeningBalanceView) => ({ ...d, lineCount: d.lines.length });

const lists = {
  'GET /locations': () => jsonResponse(200, [PLANT_SITE, IN_TRANSIT]),
  'GET /items': () => jsonResponse(200, [CHICKEN, FLOUR]),
  'GET /units': () => jsonResponse(200, UNITS),
};

describe('opening balances', () => {
  it('lets anyone read a posted document and the lots it made, but not change it; passes axe', async () => {
    const posted = doc({});
    mockApi({
      ...lists,
      'GET /opening-balances': () => jsonResponse(200, [summary(posted)]),
      [`GET /opening-balances/${posted.id}`]: () => jsonResponse(200, posted),
    });
    const view = renderApp('/opening-balances', { as: STAFF });
    const u = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'ยอดยกมา' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'สร้างยอดยกมา' })).not.toBeInTheDocument();
    const listed = within(
      (await screen.findByRole('rowheader', { name: 'OB-2026-00001' })).closest('tr')!,
    );
    expect(listed.getByText('post แล้ว')).toBeVisible();
    expect(listed.getByText('1,566')).toBeVisible();

    await u.click(listed.getByRole('button', { name: 'เปิด OB-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ยอดยกมา OB-2026-00001/ });
    expect(within(panel).getByText('OB-2026-00001/1')).toBeVisible();
    expect(within(panel).getByText('21.600 กิโลกรัม')).toBeVisible();
    expect(within(panel).getByText('12 ชิ้น')).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'กลับรายการเอกสารนี้' })).toBeNull();
    expect(await axeViolations()).toEqual([]);

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/opening-balances', { as: STAFF });
    expect(await screen.findByText('Posted')).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('lets the plant draft one, asking pieces only for variable-weight items, then post it', async () => {
    let saved: OpeningBalanceView | null = null;
    const api = mockApi({
      ...lists,
      'GET /opening-balances': () => jsonResponse(200, saved ? [summary(saved)] : []),
      'POST /opening-balances': (init) => {
        const body = JSON.parse(String(init.body));
        saved = doc({
          status: 'draft',
          revision: 1,
          postedAt: null,
          postedBy: null,
          businessDate: '2026-09-26',
          note: body.note || null,
          totalValue: '9691',
          lines: [
            line({}),
            line({
              lineNo: 2,
              item: {
                ...line({}).item,
                id: FLOUR.id,
                code: 'FLOUR',
                nameTh: 'แป้งชุบทอด',
                variableWeight: false,
              },
              quantity: '250.000',
              secondaryQuantity: null,
              unitCost: '32.5',
              value: '8125',
            }),
          ],
        });
        return jsonResponse(201, saved);
      },
      [`GET /opening-balances/${doc({}).id}`]: () => jsonResponse(200, saved),
      [`POST /opening-balances/${doc({}).id}/post`]: () => {
        saved = doc({
          ...saved!,
          status: 'posted',
          revision: 2,
          postedAt: '2026-09-26T04:00:00.000Z',
          postedBy: PERSON,
          lines: saved!.lines.map((l) => ({
            ...l,
            lot: { id: `lot-${l.lineNo}`, number: `OB-2026-00001/${l.lineNo}` },
          })),
        });
        return jsonResponse(200, saved);
      },
    });
    renderApp('/opening-balances', { as: PLANT });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'สร้างยอดยกมา' }));
    const form = screen.getByRole('form', { name: 'ยอดยกมาใหม่' });
    const location = within(form).getByLabelText('สถานที่');
    expect(within(location).queryByRole('option', { name: /IN-TRANSIT/ })).toBeNull();
    await u.selectOptions(location, 'PLANT-01 · โรงงานบางนา');
    await u.selectOptions(
      within(form).getByLabelText('สินค้า (บรรทัดที่ 1)'),
      'WHOLE-CHICKEN · ไก่ทั้งตัว',
    );
    await u.type(within(form).getByLabelText('จำนวนเป็นกิโลกรัม (บรรทัดที่ 1)'), '21.6');
    await u.type(within(form).getByLabelText('จำนวนชิ้น (บรรทัดที่ 1)'), '12');
    await u.type(within(form).getByLabelText('ต้นทุนต่อกิโลกรัม (บรรทัดที่ 1)'), '72.5');
    await u.type(within(form).getByLabelText('วันหมดอายุ (บรรทัดที่ 1)'), '2026-09-29');
    await u.click(within(form).getByRole('button', { name: 'เพิ่มบรรทัด' }));
    await u.selectOptions(
      within(form).getByLabelText('สินค้า (บรรทัดที่ 2)'),
      'FLOUR · แป้งชุบทอด',
    );
    expect(within(form).queryByLabelText('จำนวนชิ้น (บรรทัดที่ 2)')).toBeNull();
    await u.type(within(form).getByLabelText('จำนวนเป็นกิโลกรัม (บรรทัดที่ 2)'), '250');
    await u.type(within(form).getByLabelText('ต้นทุนต่อกิโลกรัม (บรรทัดที่ 2)'), '32.5');
    await u.type(within(form).getByLabelText('วันหมดอายุ (บรรทัดที่ 2)'), '2027-02-23');
    expect(await axeViolations()).toEqual([]);
    await u.click(within(form).getByRole('button', { name: 'บันทึกร่าง' }));

    expect(await screen.findByText('สร้างร่าง OB-2026-00001 แล้ว ตรวจแล้วค่อย post')).toBeVisible();
    const create = api.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(api, create)).toEqual({
      locationId: PLANT_SITE.id,
      note: '',
      lines: [
        {
          itemId: CHICKEN.id,
          quantity: '21.6',
          secondaryQuantity: '12',
          unitCost: '72.5',
          expiryDate: '2026-09-29',
        },
        {
          itemId: FLOUR.id,
          quantity: '250',
          secondaryQuantity: null,
          unitCost: '32.5',
          expiryDate: '2027-02-23',
        },
      ],
    });

    const draft = await screen.findByRole('form', { name: 'ร่างยอดยกมา OB-2026-00001' });
    await u.click(within(draft).getByRole('button', { name: 'Post เอกสารนี้' }));
    expect(
      within(draft).getByText(/Post OB-2026-00001\? จะสร้าง 2 lot มูลค่า 9,691 บาท/),
    ).toBeVisible();
    await u.click(within(draft).getByRole('button', { name: 'ยืนยัน post' }));

    expect(await screen.findByText('post OB-2026-00001 แล้ว: สร้าง 2 lot')).toBeVisible();
    const postCall = api.mock.calls.findIndex(([url]) => String(url).endsWith('/post'));
    expect(sentBody(api, postCall)).toEqual({ revision: 1 });
    expect(await screen.findByText('OB-2026-00001/2')).toBeVisible();
  });

  it('says which rule refused a posting, and on which line', async () => {
    const draft = doc({ status: 'draft', revision: 3, postedAt: null, postedBy: null });
    mockApi({
      ...lists,
      'GET /opening-balances': () => jsonResponse(200, [summary(draft)]),
      [`GET /opening-balances/${draft.id}`]: () => jsonResponse(200, draft),
      [`POST /opening-balances/${draft.id}/post`]: () =>
        jsonResponse(422, {
          code: 'POSTING_REFUSED',
          message: 'x',
          details: { rule: 'expired_lot', lineNo: 1 },
        }),
    });
    renderApp('/opening-balances', { as: PLANT });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด OB-2026-00001' }));
    const form = await screen.findByRole('form', { name: 'ร่างยอดยกมา OB-2026-00001' });
    await u.click(within(form).getByRole('button', { name: 'Post เอกสารนี้' }));
    await u.click(within(form).getByRole('button', { name: 'ยืนยัน post' }));
    expect(
      await within(form).findByText(/บรรทัดที่ 1: lot นี้หมดอายุก่อนวันที่เกิดรายการแล้ว/),
    ).toBeVisible();
  });

  it('lets the plant reverse a posted document once, with a reason', async () => {
    let current = doc({});
    const api = mockApi({
      ...lists,
      'GET /opening-balances': () => jsonResponse(200, [summary(current)]),
      [`GET /opening-balances/${current.id}`]: () => jsonResponse(200, current),
      [`POST /opening-balances/${current.id}/reverse`]: () => {
        current = doc({
          reversedBy: {
            id: '00000000-0000-4000-8000-0000000000f1',
            number: 'RV-2026-00001',
            businessDate: '2026-09-26',
            note: 'นับซ้ำ',
            postedAt: '2026-09-26T05:00:00.000Z',
            postedBy: PERSON,
          },
        });
        return jsonResponse(200, current);
      },
    });
    renderApp('/opening-balances', { as: PLANT });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด OB-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ยอดยกมา OB-2026-00001/ });
    await u.type(within(panel).getByLabelText('เหตุผล'), 'นับซ้ำ');
    await u.click(within(panel).getByRole('button', { name: 'กลับรายการเอกสารนี้' }));
    await u.click(within(panel).getByRole('button', { name: 'ยืนยันกลับรายการ' }));

    expect(
      await screen.findByText('กลับรายการ OB-2026-00001 ด้วย RV-2026-00001 แล้ว'),
    ).toBeVisible();
    const call = api.mock.calls.findIndex(([url]) => String(url).endsWith('/reverse'));
    expect(sentBody(api, call)).toEqual({ note: 'นับซ้ำ' });
    expect(await screen.findByText(/เอกสารนี้ถูกกลับรายการด้วย RV-2026-00001/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'กลับรายการเอกสารนี้' })).toBeNull();
  });
});

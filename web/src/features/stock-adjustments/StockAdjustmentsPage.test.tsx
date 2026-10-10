// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import {
  APPROVER,
  axeViolations,
  jsonResponse,
  mockApi,
  PLANT,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import type { ItemView } from '@/features/items/items.api';
import type { StockOnHandView } from '@/features/stock/stock.api';
import type { AdjustmentView } from './stock-adjustments.api';

const UNITS = [{ code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 }];
const PLANT_SITE = {
  id: '00000000-0000-4000-8000-0000000000a1',
  code: 'PLANT-01',
  type: 'plant' as const,
  nameTh: 'โรงงานบางนา',
  nameEn: 'Bang Na plant',
  active: true,
};
const CHICKEN: ItemView = {
  id: '00000000-0000-4000-8000-0000000000b1',
  code: 'WHOLE-CHICKEN',
  nameTh: 'ไก่ทั้งตัว',
  nameEn: 'Whole chicken',
  baseUnitCode: 'kg',
  variableWeight: true,
  shelfLifeDays: 5,
  receivingTolerances: { maxVariancePercent: null, maxTemperature: null },
  requisitionUnit: null,
  active: true,
  purchaseUnits: [],
  version: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};
const LOT = { id: '00000000-0000-4000-8000-0000000000c1', number: 'OB-2026-00001/3' };

const HELD: StockOnHandView = {
  asOf: '2026-09-27',
  totalValue: '1566',
  negativeBranchBalances: 0,
  rows: [
    {
      item: {
        id: CHICKEN.id,
        code: CHICKEN.code,
        nameTh: CHICKEN.nameTh,
        nameEn: CHICKEN.nameEn,
        baseUnitCode: 'kg',
      },
      lot: { ...LOT, expiryDate: '2026-09-28', placeholderCost: null },
      location: PLANT_SITE,
      quantity: '21.600',
      secondaryQuantity: '12',
      unitCost: '72.5',
      value: '1566',
      expired: false,
      countRecommended: false,
    },
  ],
};

const RAISER = { id: PLANT.id, displayName: 'Demo plant' };
const FINANCE = { id: APPROVER.id, displayName: 'Demo finance' };

const doc = (overrides: Partial<AdjustmentView>): AdjustmentView => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  number: 'AD-2026-00001',
  status: 'submitted',
  businessDate: '2026-09-27',
  note: null,
  revision: 2,
  createdBy: RAISER,
  createdAt: '2026-09-27T03:00:00.000Z',
  postedBy: null,
  postedAt: null,
  location: PLANT_SITE,
  totalValue: '-130.5',
  submitted: { by: RAISER, at: '2026-09-27T03:05:00.000Z' },
  approved: null,
  rejected: null,
  lines: [
    {
      lineNo: 1,
      item: {
        id: CHICKEN.id,
        code: CHICKEN.code,
        nameTh: CHICKEN.nameTh,
        nameEn: CHICKEN.nameEn,
        baseUnitCode: 'kg',
        variableWeight: true,
      },
      lot: { ...LOT, expiryDate: '2026-09-28' },
      quantity: '-1.800',
      secondaryQuantity: '-1',
      unitCost: '72.5',
      value: '-130.5',
      reason: 'เสียในห้องเย็น',
    },
  ],
  ...overrides,
});
const summary = (d: AdjustmentView) => ({ ...d, lineCount: d.lines.length });
const POSTED = doc({
  status: 'posted',
  revision: 4,
  approved: { by: FINANCE, at: '2026-09-27T04:00:00.000Z' },
  postedBy: FINANCE,
  postedAt: '2026-09-27T04:00:00.000Z',
});

const lists = {
  'GET /locations': () => jsonResponse(200, [PLANT_SITE]),
  'GET /items': () => jsonResponse(200, [CHICKEN]),
  'GET /units': () => jsonResponse(200, UNITS),
  'GET /stock-on-hand': () => jsonResponse(200, HELD),
};

describe('stock adjustments', () => {
  it('lets anyone read a posted write-off, who raised and who approved it; passes axe in both languages', async () => {
    mockApi({
      ...lists,
      'GET /stock-adjustments': () => jsonResponse(200, [summary(POSTED)]),
      [`GET /stock-adjustments/${POSTED.id}`]: () => jsonResponse(200, POSTED),
    });
    const view = renderApp('/stock-adjustments', { as: { ...STAFF, id: 'someone-else' } });
    const u = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'ใบปรับยอด' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'สร้างใบปรับยอด' })).toBeNull();
    const listed = within(
      (await screen.findByRole('rowheader', { name: 'AD-2026-00001' })).closest('tr')!,
    );
    expect(listed.getByText('post แล้ว')).toBeVisible();
    expect(listed.getByText('-130.5')).toBeVisible();

    await u.click(listed.getByRole('button', { name: 'เปิด AD-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบปรับยอด AD-2026-00001/ });
    expect(within(panel).getByText('-1.800 กิโลกรัม')).toBeVisible();
    expect(within(panel).getByText('-1 ชิ้น')).toBeVisible();
    expect(within(panel).getByText('เสียในห้องเย็น')).toBeVisible();
    // Raised by the plant; approved, and so posted, by finance.
    expect(within(panel).getAllByText(/โดย Demo plant/, { selector: 'dd' })).toHaveLength(2);
    expect(within(panel).getAllByText(/โดย Demo finance/, { selector: 'dd' })).toHaveLength(2);
    expect(within(panel).queryByRole('button', { name: 'อนุมัติและ post' })).toBeNull();
    expect(await axeViolations()).toEqual([]);

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/stock-adjustments', { as: STAFF });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Stock adjustments' }),
    ).toBeVisible();
    expect(await screen.findByText('Posted')).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('lets the plant raise a write-off on a lot held there, signed, with a reason, and submit it', async () => {
    let saved: AdjustmentView | undefined;
    const api = mockApi({
      ...lists,
      'GET /stock-adjustments': () => jsonResponse(200, saved ? [summary(saved)] : []),
      'POST /stock-adjustments': () => {
        saved = doc({ status: 'draft', revision: 1, submitted: null });
        return jsonResponse(201, saved);
      },
      [`GET /stock-adjustments/${doc({}).id}`]: () => jsonResponse(200, saved),
      [`POST /stock-adjustments/${doc({}).id}/submit`]: () => {
        saved = doc({});
        return jsonResponse(200, saved);
      },
    });
    renderApp('/stock-adjustments', { as: PLANT });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'สร้างใบปรับยอด' }));
    const form = screen.getByRole('form', { name: 'ใบปรับยอดใหม่' });
    await u.selectOptions(within(form).getByLabelText('สถานที่'), 'PLANT-01 · โรงงานบางนา');
    await u.selectOptions(
      within(form).getByLabelText('lot (บรรทัดที่ 1)'),
      await within(form).findByRole('option', { name: /OB-2026-00001\/3 · ไก่ทั้งตัว · 21.600/ }),
    );
    expect(within(form).getByLabelText('ตัดออกหรือเพิ่มเข้า (บรรทัดที่ 1)')).toHaveValue('out');
    await u.type(within(form).getByLabelText('จำนวนเป็นกิโลกรัม (บรรทัดที่ 1)'), '1.8');
    await u.type(within(form).getByLabelText('จำนวนชิ้น (บรรทัดที่ 1)'), '1');
    await u.type(within(form).getByLabelText('เหตุผล (บรรทัดที่ 1)'), 'เสียในห้องเย็น');
    expect(await axeViolations()).toEqual([]);
    await u.click(within(form).getByRole('button', { name: 'บันทึกร่าง' }));

    expect(
      await screen.findByText('สร้างร่าง AD-2026-00001 แล้ว ตรวจแล้วส่งอนุมัติ'),
    ).toBeVisible();
    const create = api.mock.calls.findIndex(
      ([url, init]) => init?.method === 'POST' && String(url).endsWith('/stock-adjustments'),
    );
    expect(sentBody(api, create)).toEqual({
      locationId: PLANT_SITE.id,
      note: '',
      lines: [
        { lotId: LOT.id, quantity: '-1.8', secondaryQuantity: '-1', reason: 'เสียในห้องเย็น' },
      ],
    });

    const draft = await screen.findByRole('form', { name: 'ร่างใบปรับยอด AD-2026-00001' });
    await u.click(within(draft).getByRole('button', { name: 'ส่งอนุมัติ' }));
    await u.click(within(draft).getByRole('button', { name: 'ส่งอนุมัติเลย' }));
    expect(await screen.findByText('ส่ง AD-2026-00001 ให้อนุมัติแล้ว')).toBeVisible();
    const submit = api.mock.calls.findIndex(([url]) => String(url).endsWith('/submit'));
    expect(sentBody(api, submit)).toEqual({ revision: 1 });
  });

  it('never offers approval to the person who raised it, whatever permissions they hold', async () => {
    const submitted = doc({});
    mockApi({
      ...lists,
      'GET /stock-adjustments': () => jsonResponse(200, [summary(submitted)]),
      [`GET /stock-adjustments/${submitted.id}`]: () => jsonResponse(200, submitted),
    });
    renderApp('/stock-adjustments', {
      as: { ...PLANT, permissions: [...PLANT.permissions, 'stock_adjustment:approve'] },
    });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด AD-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบปรับยอด AD-2026-00001/ });
    expect(within(panel).getByText(/คุณเป็นคนสร้างใบปรับยอดนี้ จึงอนุมัติเองไม่ได้/)).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'อนุมัติและ post' })).toBeNull();
  });

  it('lets finance approve, which posts, and says when the API refuses the approver', async () => {
    let current = doc({});
    let refuse = true;
    const api = mockApi({
      ...lists,
      'GET /stock-adjustments': () => jsonResponse(200, [summary(current)]),
      [`GET /stock-adjustments/${current.id}`]: () => jsonResponse(200, current),
      [`POST /stock-adjustments/${current.id}/approve`]: () => {
        if (refuse) {
          refuse = false;
          return jsonResponse(422, {
            code: 'POSTING_REFUSED',
            message: 'x',
            details: { rule: 'self_approval' },
          });
        }
        current = POSTED;
        return jsonResponse(200, { ...POSTED, postingRefusal: null });
      },
    });
    renderApp('/stock-adjustments', { as: APPROVER });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด AD-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบปรับยอด AD-2026-00001/ });
    await u.click(within(panel).getByRole('button', { name: 'อนุมัติและ post' }));
    expect(
      within(panel).getByText(/อนุมัติ AD-2026-00001\? ระบบจะ post ทันที มูลค่า -130.5 บาท/),
    ).toBeVisible();
    await u.click(within(panel).getByRole('button', { name: 'อนุมัติเลย' }));
    expect(await within(panel).findByText(/จึงอนุมัติเองไม่ได้/)).toBeVisible();

    await u.click(within(panel).getByRole('button', { name: 'อนุมัติและ post' }));
    await u.click(within(panel).getByRole('button', { name: 'อนุมัติเลย' }));
    expect(
      await screen.findByText('อนุมัติและ post AD-2026-00001 แล้ว สต๊อกคงเหลือเปลี่ยนตามนี้แล้ว'),
    ).toBeVisible();
    const approve = api.mock.calls.findIndex(([url]) => String(url).endsWith('/approve'));
    expect(sentBody(api, approve)).toEqual({ revision: 2 });
  });

  it('keeps an approval the ledger refused to post, says why, and lets it be rejected with a reason', async () => {
    let current = doc({});
    const api = mockApi({
      ...lists,
      'GET /stock-adjustments': () => jsonResponse(200, [summary(current)]),
      [`GET /stock-adjustments/${current.id}`]: () => jsonResponse(200, current),
      [`POST /stock-adjustments/${current.id}/approve`]: () => {
        current = doc({
          status: 'approved',
          revision: 3,
          approved: { by: FINANCE, at: '2026-09-27T04:00:00.000Z' },
        });
        return jsonResponse(200, {
          ...current,
          postingRefusal: {
            rule: 'negative_stock_plant',
            message: 'x',
            details: { lotNumber: LOT.number, locationCode: 'PLANT-01' },
          },
        });
      },
      [`POST /stock-adjustments/${current.id}/reject`]: () => {
        current = doc({
          status: 'rejected',
          revision: 4,
          approved: current.approved,
          rejected: { by: FINANCE, at: '2026-09-27T05:00:00.000Z', reason: 'ของถูกใช้ไปแล้ว' },
        });
        return jsonResponse(200, current);
      },
    });
    renderApp('/stock-adjustments', { as: APPROVER });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิด AD-2026-00001' }));
    let panel = await screen.findByRole('region', { name: /ใบปรับยอด AD-2026-00001/ });
    await u.click(within(panel).getByRole('button', { name: 'อนุมัติและ post' }));
    await u.click(within(panel).getByRole('button', { name: 'อนุมัติเลย' }));
    expect(
      await screen.findByText(
        /อนุมัติ AD-2026-00001 แล้ว แต่ยัง post ไม่ได้ ทำแล้ว lot OB-2026-00001\/3 จะติดลบที่ PLANT-01/,
      ),
    ).toBeVisible();

    panel = await screen.findByRole('region', { name: /ใบปรับยอด AD-2026-00001/ });
    expect(await within(panel).findByRole('button', { name: 'post อีกครั้ง' })).toBeVisible();
    const reject = within(panel).getByRole('button', { name: 'ไม่อนุมัติ' });
    expect(reject).toBeDisabled();
    await u.type(within(panel).getByLabelText('เหตุผลที่ไม่อนุมัติ'), 'ของถูกใช้ไปแล้ว');
    await u.click(reject);
    expect(await screen.findByText('ไม่อนุมัติ AD-2026-00001 แล้ว')).toBeVisible();
    const call = api.mock.calls.findIndex(([url]) => String(url).endsWith('/reject'));
    expect(sentBody(api, call)).toEqual({ revision: 3, reason: 'ของถูกใช้ไปแล้ว' });
  });
});

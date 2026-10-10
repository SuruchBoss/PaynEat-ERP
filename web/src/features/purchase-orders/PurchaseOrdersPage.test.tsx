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
  PO_APPROVER,
  PURCHASING,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import type { ItemView } from '@/features/items/items.api';
import type { PurchaseOrderView } from './purchase-orders.api';

const FINANCE_READER = { ...STAFF, permissions: ['purchase_order:read'] };

const UNITS = [
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'case', nameTh: 'ลัง', nameEn: 'case', decimals: 0 },
];
const PLANT_SITE = {
  id: '00000000-0000-4000-8000-0000000000a1',
  code: 'PLANT-01',
  type: 'plant' as const,
  nameTh: 'โรงงานบางนา',
  nameEn: 'Bang Na plant',
  active: true,
};
const BRANCH = {
  id: '00000000-0000-4000-8000-0000000000a2',
  code: 'BR-SILOM',
  type: 'branch' as const,
  nameTh: 'สาขาสีลม',
  nameEn: 'Silom branch',
  active: true,
};
const SUPPLIER = {
  id: '00000000-0000-4000-8000-0000000000e1',
  code: 'SUP-CHICKEN',
  name: 'บริษัท ฟาร์มไก่เดโม จำกัด (สมมติ)',
  taxId: '0000000000001',
  contactName: null,
  phone: null,
  email: null,
  address: null,
  active: true,
  revision: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
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
  purchaseUnits: [{ unitCode: 'case', factor: '20' }],
  version: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};

const RAISER = { id: PURCHASING.id, displayName: 'Demo purchasing' };
const APPROVER = { id: PO_APPROVER.id, displayName: 'Demo purchasing approver' };

const order = (overrides: Partial<PurchaseOrderView>): PurchaseOrderView => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  number: 'PO-2026-00001',
  status: 'submitted',
  revision: 2,
  supplier: { id: SUPPLIER.id, code: SUPPLIER.code, name: SUPPLIER.name, taxId: SUPPLIER.taxId },
  deliveryLocation: PLANT_SITE,
  expectedDeliveryDate: '2026-10-07',
  note: null,
  totals: { net: '25680.00', vat: '1797.60', gross: '27477.60' },
  createdBy: RAISER,
  createdAt: '2026-10-05T03:00:00.000Z',
  submitted: { by: RAISER, at: '2026-10-05T03:05:00.000Z', approvalThreshold: '20000.00' },
  approved: null,
  rejected: null,
  sent: null,
  cancelled: null,
  approval: { threshold: '20000.00', needsApprover: true },
  lines: [
    {
      lineNo: 1,
      item: {
        id: CHICKEN.id,
        code: CHICKEN.code,
        nameTh: CHICKEN.nameTh,
        nameEn: CHICKEN.nameEn,
        active: true,
        baseUnitCode: 'kg',
      },
      unit: { code: 'case', nameTh: 'ลัง', nameEn: 'case' },
      factor: '20',
      quantity: '20',
      unitPrice: '1284',
      vatRate: '7',
      vatRecoverable: true,
      net: '25680.00',
      vat: '1797.60',
      gross: '27477.60',
      baseQuantity: '400.000',
      unitCost: '64.200000',
      receivedQuantity: '0.000',
      returnedQuantity: '0.000',
    },
  ],
  ...overrides,
});
const summary = (o: PurchaseOrderView) => {
  const {
    lines,
    note: _note,
    submitted: _s,
    approved: _a,
    rejected: _r,
    sent: _se,
    cancelled: _c,
    approval: _ap,
    ...rest
  } = o;
  return { ...rest, lineCount: lines.length };
};

const SENT = order({
  status: 'sent',
  revision: 4,
  approved: { by: null, at: '2026-10-05T03:05:00.000Z', automatically: true },
  sent: { by: RAISER, at: '2026-10-05T04:00:00.000Z' },
});

const lists = {
  'GET /company/settings': () =>
    jsonResponse(200, { purchaseApprovalThreshold: '20000.00', revision: 1, updated: null }),
  'GET /suppliers': () => jsonResponse(200, [SUPPLIER]),
  'GET /locations': () => jsonResponse(200, [PLANT_SITE, BRANCH]),
  'GET /items': () => jsonResponse(200, [CHICKEN]),
  'GET /units': () => jsonResponse(200, UNITS),
};

describe('purchase orders', () => {
  it('lets finance read a sent order, its money and who approved it; passes axe in both languages', async () => {
    mockApi({
      ...lists,
      'GET /purchase-orders': () => jsonResponse(200, [summary(SENT)]),
      [`GET /purchase-orders/${SENT.id}`]: () => jsonResponse(200, SENT),
    });
    const view = renderApp('/purchase-orders', { as: FINANCE_READER });
    const u = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'ใบสั่งซื้อ' })).toBeVisible();
    expect(
      await screen.findByText(
        'ใบสั่งซื้อที่ยอดรวม VAT เกิน 20,000.00 บาท ต้องมีผู้อนุมัติการจัดซื้ออนุมัติ',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'สร้างใบสั่งซื้อ' })).toBeNull();
    const listed = within(
      (await screen.findByRole('rowheader', { name: 'PO-2026-00001' })).closest('tr')!,
    );
    expect(listed.getByText('ส่งซัพพลายเออร์แล้ว')).toBeVisible();
    expect(listed.getByText('27,477.60')).toBeVisible();

    await u.click(listed.getByRole('button', { name: 'เปิดใบสั่งซื้อ PO-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบสั่งซื้อ PO-2026-00001/ });
    expect(within(panel).getByText(/อนุมัติอัตโนมัติ/)).toBeVisible();
    expect(within(panel).getByText('64.200000 ต่อ กิโลกรัม')).toBeVisible();
    expect(within(panel).getByText('7% ขอคืนได้')).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'อนุมัติ' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'ยกเลิกใบสั่งซื้อ' })).toBeNull();
    expect(await axeViolations()).toEqual([]);

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/purchase-orders', { as: FINANCE_READER });
    expect(await screen.findByRole('heading', { level: 1, name: 'Purchase orders' })).toBeVisible();
    expect(await screen.findByText('Sent to supplier')).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('lets purchasing draft an order to a plant in the item’s purchase unit, and submit it', async () => {
    let saved: PurchaseOrderView | undefined;
    const api = mockApi({
      ...lists,
      'GET /purchase-orders': () => jsonResponse(200, saved ? [summary(saved)] : []),
      'POST /purchase-orders': () => {
        saved = order({
          status: 'draft',
          revision: 1,
          submitted: null,
          totals: { net: '15408.00', vat: '1078.56', gross: '16486.56' },
          approval: { threshold: '20000.00', needsApprover: false },
        });
        return jsonResponse(201, saved);
      },
      [`GET /purchase-orders/${order({}).id}`]: () => jsonResponse(200, saved),
      [`POST /purchase-orders/${order({}).id}/submit`]: () => {
        saved = order({
          status: 'approved',
          revision: 2,
          approved: { by: null, at: '2026-10-05T03:05:00.000Z', automatically: true },
        });
        return jsonResponse(200, saved);
      },
    });
    renderApp('/purchase-orders', { as: PURCHASING });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'สร้างใบสั่งซื้อ' }));
    const form = screen.getByRole('form', { name: 'ใบสั่งซื้อใหม่' });
    await u.selectOptions(
      within(form).getByLabelText('ซัพพลายเออร์'),
      await within(form).findByRole('option', { name: /SUP-CHICKEN/ }),
    );
    // A branch never receives supplier goods: only the plant is offered.
    const location = within(form).getByLabelText('ส่งที่ (โรงงานหรือคลัง)');
    expect(within(location).queryByRole('option', { name: /BR-SILOM/ })).toBeNull();
    await u.selectOptions(location, 'PLANT-01 · โรงงานบางนา');
    // Day first, in the Buddhist year, as a Thai reader writes it (#48).
    await u.type(within(form).getByLabelText('วันที่คาดว่าจะได้รับ'), '7/10/2569');
    await u.selectOptions(
      within(form).getByLabelText('สินค้า บรรทัดที่ 1'),
      'WHOLE-CHICKEN · ไก่ทั้งตัว',
    );
    expect(within(form).getByLabelText('หน่วยซื้อ บรรทัดที่ 1')).toHaveValue('case');
    await u.type(within(form).getByLabelText('จำนวน บรรทัดที่ 1'), '12');
    await u.type(within(form).getByLabelText('ราคาต่อหน่วยซื้อ บรรทัดที่ 1'), '1284.00');
    expect(within(form).getByLabelText('อัตรา VAT (%) บรรทัดที่ 1')).toHaveValue('7');
    expect(within(form).getByLabelText('ขอคืน VAT ได้ บรรทัดที่ 1')).toBeChecked();
    expect(await axeViolations()).toEqual([]);
    await u.click(within(form).getByRole('button', { name: 'บันทึกร่าง' }));

    expect(await screen.findByText('สร้างร่างใบสั่งซื้อ PO-2026-00001 แล้ว')).toBeVisible();
    const create = api.mock.calls.findIndex(
      ([url, init]) => init?.method === 'POST' && String(url).endsWith('/purchase-orders'),
    );
    expect(sentBody(api, create)).toMatchObject({
      supplierId: SUPPLIER.id,
      deliveryLocationId: PLANT_SITE.id,
      expectedDeliveryDate: '2026-10-07',
      note: '',
      lines: [
        {
          itemId: CHICKEN.id,
          unitCode: 'case',
          quantity: '12',
          unitPrice: '1284.00',
          vatRate: '7',
          vatRecoverable: true,
        },
      ],
    });

    expect(
      await screen.findByText(
        /ยอดรวม VAT ไม่เกินเกณฑ์ 20,000.00 บาท เมื่อส่งอนุมัติจะอนุมัติทันที/,
      ),
    ).toBeVisible();
    await u.click(screen.getByRole('button', { name: 'ส่งอนุมัติ' }));
    expect(
      await screen.findByText('ส่ง PO-2026-00001 แล้ว และอนุมัติทันทีเพราะไม่เกินเกณฑ์วงเงิน'),
    ).toBeVisible();
    const submit = api.mock.calls.findIndex(([url]) => String(url).endsWith('/submit'));
    expect(sentBody(api, submit)).toEqual({ revision: 1 });
  });

  it('never offers approval to the person who created the order, whatever permissions they hold', async () => {
    const submitted = order({});
    mockApi({
      ...lists,
      'GET /purchase-orders': () => jsonResponse(200, [summary(submitted)]),
      [`GET /purchase-orders/${submitted.id}`]: () => jsonResponse(200, submitted),
    });
    renderApp('/purchase-orders', {
      as: { ...PURCHASING, permissions: [...PURCHASING.permissions, 'purchase_order:approve'] },
    });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิดใบสั่งซื้อ PO-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบสั่งซื้อ PO-2026-00001/ });
    expect(
      within(panel).getByText(/คุณเป็นผู้สร้างใบสั่งซื้อนี้ จึงอนุมัติเองไม่ได้/),
    ).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'อนุมัติ' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'ไม่อนุมัติ' })).toBeNull();
  });

  it('lets an approver approve, and reject only with a reason', async () => {
    let current = order({});
    const api = mockApi({
      ...lists,
      'GET /purchase-orders': () => jsonResponse(200, [summary(current)]),
      [`GET /purchase-orders/${current.id}`]: () => jsonResponse(200, current),
      [`POST /purchase-orders/${current.id}/reject`]: () => {
        current = order({
          status: 'rejected',
          revision: 3,
          rejected: { by: APPROVER, at: '2026-10-05T04:00:00.000Z', reason: 'ราคาสูงกว่าที่ตกลง' },
        });
        return jsonResponse(200, current);
      },
    });
    renderApp('/purchase-orders', { as: PO_APPROVER });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิดใบสั่งซื้อ PO-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบสั่งซื้อ PO-2026-00001/ });
    expect(within(panel).getByRole('button', { name: 'อนุมัติ' })).toBeEnabled();
    const reject = within(panel).getByRole('button', { name: 'ไม่อนุมัติ' });
    expect(reject).toBeDisabled();
    // An approver cannot cancel: that is purchasing's step.
    expect(within(panel).queryByRole('button', { name: 'ยกเลิกใบสั่งซื้อ' })).toBeNull();

    await u.type(
      within(panel).getByLabelText('เหตุผล (สำหรับไม่อนุมัติหรือยกเลิก)'),
      'ราคาสูงกว่าที่ตกลง',
    );
    await u.click(reject);
    expect(await screen.findByText('ไม่อนุมัติ PO-2026-00001 แล้ว')).toBeVisible();
    const call = api.mock.calls.findIndex(([url]) => String(url).endsWith('/reject'));
    expect(sentBody(api, call)).toEqual({ revision: 2, reason: 'ราคาสูงกว่าที่ตกลง' });
  });

  it('shows the API’s reason when the approver is refused', async () => {
    const current = order({});
    mockApi({
      ...lists,
      'GET /purchase-orders': () => jsonResponse(200, [summary(current)]),
      [`GET /purchase-orders/${current.id}`]: () => jsonResponse(200, current),
      [`POST /purchase-orders/${current.id}/approve`]: () =>
        jsonResponse(422, {
          code: 'PURCHASE_ORDER_REFUSED',
          message: 'x',
          details: { rule: 'self_approval' },
        }),
    });
    renderApp('/purchase-orders', { as: PO_APPROVER });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิดใบสั่งซื้อ PO-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบสั่งซื้อ PO-2026-00001/ });
    await u.click(within(panel).getByRole('button', { name: 'อนุมัติ' }));
    expect(
      await within(panel).findByText(
        /คุณเป็นผู้สร้างใบสั่งซื้อนี้ จึงอนุมัติเองไม่ได้ ต้องให้ผู้อื่นอนุมัติ/,
      ),
    ).toBeVisible();
  });

  it('is not in the navigation of someone who cannot read purchase orders', async () => {
    mockApi({});
    // A branch manager reads neither orders nor receipts; the plant reads both (#11).
    renderApp('/', { as: { ...PLANT, roles: ['branch_manager'], permissions: ['menu:read'] } });
    expect(await screen.findByRole('navigation', { name: 'เมนูหลัก' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'ใบสั่งซื้อ' })).toBeNull();
  });
});

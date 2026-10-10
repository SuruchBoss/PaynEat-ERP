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
  renderApp,
  sentBody,
} from '@/test/render';
import type { ItemView } from '@/features/items/items.api';
import type { PurchaseOrderView } from '@/features/purchase-orders/purchase-orders.api';
import type { GoodsReceiptLine, GoodsReceiptView } from './goods-receipts.api';

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
};
const SUPPLIER = {
  id: '00000000-0000-4000-8000-0000000000e1',
  code: 'SUP-CHICKEN',
  name: 'บริษัท ฟาร์มไก่เดโม จำกัด (สมมติ)',
  taxId: '0000000000001',
};
const CHICKEN: ItemView = {
  id: '00000000-0000-4000-8000-0000000000b1',
  code: 'WHOLE-CHICKEN',
  nameTh: 'ไก่ทั้งตัว',
  nameEn: 'Whole chicken',
  baseUnitCode: 'kg',
  variableWeight: true,
  shelfLifeDays: 5,
  receivingTolerances: { maxVariancePercent: '2', maxTemperature: '4' },
  requisitionUnit: null,
  active: true,
  purchaseUnits: [{ unitCode: 'case', factor: '20' }],
  version: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};
const RAISER = { id: '6c1d0a52-6d8e-4c52-9a55-3d7f0b3a0003', displayName: 'Demo purchasing' };
const RECEIVER = { id: PLANT.id, displayName: 'Demo plant' };

const ORDER: PurchaseOrderView = {
  id: '00000000-0000-4000-8000-0000000000d1',
  number: 'PO-2026-00001',
  status: 'sent',
  revision: 4,
  supplier: SUPPLIER,
  deliveryLocation: PLANT_SITE,
  expectedDeliveryDate: '2026-10-11',
  note: null,
  totals: { net: '15408.00', vat: '1078.56', gross: '16486.56' },
  createdBy: RAISER,
  createdAt: '2026-10-09T03:00:00.000Z',
  submitted: { by: RAISER, at: '2026-10-09T03:05:00.000Z', approvalThreshold: '20000.00' },
  approved: { by: null, at: '2026-10-09T03:05:00.000Z', automatically: true },
  rejected: null,
  sent: { by: RAISER, at: '2026-10-09T03:10:00.000Z' },
  cancelled: null,
  approval: { threshold: '20000.00', needsApprover: false },
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
      quantity: '12',
      unitPrice: '1284',
      vatRate: '7',
      vatRecoverable: true,
      net: '15408.00',
      vat: '1078.56',
      gross: '16486.56',
      baseQuantity: '240.000',
      unitCost: '64.200000',
      receivedQuantity: '0.000',
      returnedQuantity: '0.000',
    },
  ],
};

/** The warm line as the API inspects it: 240 kg as 132 birds at 5.6 °C, outside the 4 °C limit. */
const warmLine = (overrides: Partial<GoodsReceiptLine> = {}): GoodsReceiptLine => ({
  lineNo: 1,
  purchaseOrderLineNo: 1,
  item: {
    id: CHICKEN.id,
    code: CHICKEN.code,
    nameTh: CHICKEN.nameTh,
    nameEn: CHICKEN.nameEn,
    baseUnitCode: 'kg',
    variableWeight: true,
  },
  unit: { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram' },
  factor: '1',
  countedQuantity: '240.000',
  rejectedQuantity: '0.000',
  acceptedQuantity: '240.000',
  countedBaseQuantity: '240.000',
  rejectedBaseQuantity: '0.000',
  acceptedBaseQuantity: '240.000',
  countedPieces: '132',
  rejectedPieces: '0',
  acceptedPieces: '132',
  temperature: '5.6',
  condition: 'good',
  reason: 'Core 3.9 °C on re-test',
  orderedBaseQuantity: '240.000',
  expectedBaseQuantity: '240.000',
  findings: [{ code: 'too_warm', temperature: '5.6', limit: '4' }],
  expiry: {
    computedExpiry: '2026-10-14',
    supplierExpiry: '2026-10-13',
    expiryDate: '2026-10-13',
    takes: 'supplier',
  },
  unitCost: '64.200000',
  value: '15408',
  overReceipt: false,
  lot: null,
  ...overrides,
});

const receipt = (overrides: Partial<GoodsReceiptView> = {}): GoodsReceiptView => ({
  id: '00000000-0000-4000-8000-0000000000f1',
  number: 'GR-2026-00001',
  status: 'submitted',
  businessDate: '2026-10-09',
  note: null,
  revision: 2,
  createdBy: RECEIVER,
  createdAt: '2026-10-09T05:00:00.000Z',
  postedBy: null,
  postedAt: null,
  purchaseOrder: { id: ORDER.id, number: ORDER.number, status: 'sent' },
  supplier: { id: SUPPLIER.id, code: SUPPLIER.code, name: SUPPLIER.name },
  location: PLANT_SITE,
  totalValue: '15408',
  submitted: { by: RECEIVER, at: '2026-10-09T05:01:00.000Z' },
  approved: null,
  rejected: null,
  needsApproval: true,
  lines: [warmLine()],
  supplierReturn: null,
  ...overrides,
});
const summary = (r: GoodsReceiptView) => ({
  id: r.id,
  number: r.number,
  status: r.status,
  businessDate: r.businessDate,
  note: r.note,
  revision: r.revision,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  postedBy: r.postedBy,
  postedAt: r.postedAt,
  purchaseOrder: r.purchaseOrder,
  supplier: r.supplier,
  location: r.location,
  totalValue: r.totalValue,
  lineCount: r.lines.length,
  linesWithFindings: r.lines.filter((l) => l.findings.length > 0).length,
});

const lists = {
  'GET /items': () => jsonResponse(200, [CHICKEN]),
  'GET /units': () => jsonResponse(200, UNITS),
  'GET /purchase-orders': () => jsonResponse(200, [{ ...ORDER, lineCount: 1, lines: undefined }]),
  [`GET /purchase-orders/${ORDER.id}`]: () => jsonResponse(200, ORDER),
};

describe('goods receipts', () => {
  it('lets the plant receive against a sent order, seeing findings as it types, and submit for approval', async () => {
    let saved: GoodsReceiptView | undefined;
    const api = mockApi({
      ...lists,
      'GET /goods-receipts': () => jsonResponse(200, saved ? [summary(saved)] : []),
      'POST /goods-receipts/preview': () =>
        jsonResponse(200, {
          lines: [warmLine({ reason: null })],
          needsApproval: true,
          totalValue: '15408',
        }),
      'POST /goods-receipts': () => {
        saved = receipt({ status: 'draft', revision: 1, submitted: null });
        return jsonResponse(201, saved);
      },
      [`GET /goods-receipts/${receipt().id}`]: () => jsonResponse(200, saved),
      [`POST /goods-receipts/${receipt().id}/submit`]: () => {
        saved = receipt();
        return jsonResponse(200, { ...saved, postingRefusal: null });
      },
    });
    renderApp('/goods-receipts', { as: PLANT });
    const u = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'รับสินค้า' })).toBeVisible();
    await u.click(await screen.findByRole('button', { name: 'รับสินค้า' }));
    const panel = screen.getByRole('region', { name: 'รับสินค้าใหม่' });
    await u.selectOptions(
      within(panel).getByLabelText('ใบสั่งซื้อที่รับ'),
      await within(panel).findByRole('option', { name: /PO-2026-00001/ }),
    );
    await u.type(await within(panel).findByLabelText('จำนวนที่นับได้ บรรทัดที่ 1'), '240');
    await u.selectOptions(within(panel).getByLabelText('หน่วยที่นับ บรรทัดที่ 1'), 'kg');
    await u.type(within(panel).getByLabelText('จำนวนตัว บรรทัดที่ 1'), '132');
    await u.type(within(panel).getByLabelText('อุณหภูมิ (°C) บรรทัดที่ 1'), '5.6');

    // The finding and the expiry arrive from the API's inspection as the receiver types.
    expect(await within(panel).findByText('5.6 °C เกินเกณฑ์ 4 °C')).toBeVisible();
    expect(within(panel).getByText(/ตามวันของซัพพลายเออร์/)).toBeVisible();
    expect(
      within(panel).getByText('มีบรรทัดนอกเกณฑ์ เมื่อส่งจะรอผู้อนุมัติการจัดซื้อที่ไม่ใช่ผู้รับ'),
    ).toBeVisible();
    await u.type(within(panel).getByLabelText(/^เหตุผล บรรทัดที่ 1/), 'Core 3.9 °C on re-test');
    expect(await axeViolations()).toEqual([]);
    await u.click(within(panel).getByRole('button', { name: 'บันทึกร่าง' }));

    expect(await screen.findByText('สร้างร่างใบรับสินค้า GR-2026-00001 แล้ว')).toBeVisible();
    const create = api.mock.calls.findIndex(
      ([url, init]) => init?.method === 'POST' && String(url).endsWith('/goods-receipts'),
    );
    expect(sentBody(api, create)).toEqual({
      purchaseOrderId: ORDER.id,
      note: '',
      lines: [
        {
          purchaseOrderLineNo: 1,
          unitCode: 'kg',
          countedQuantity: '240',
          rejectedQuantity: '0',
          countedPieces: '132',
          rejectedPieces: '0',
          temperature: '5.6',
          condition: 'good',
          supplierExpiry: null,
          reason: 'Core 3.9 °C on re-test',
        },
      ],
    });

    await u.click(await screen.findByRole('button', { name: 'ส่งให้ผู้อนุมัติ' }));
    expect(await screen.findByText('ส่ง GR-2026-00001 ให้ผู้อนุมัติการจัดซื้อแล้ว')).toBeVisible();
  });

  it('lets an approver approve a receipt someone else recorded, which posts it with its return', async () => {
    let current = receipt({
      lines: [
        warmLine({
          rejectedQuantity: '18.000',
          rejectedBaseQuantity: '18.000',
          acceptedBaseQuantity: '222.000',
          rejectedPieces: '10',
          acceptedPieces: '122',
          condition: 'damaged',
          findings: [{ code: 'too_warm', temperature: '5.6', limit: '4' }, { code: 'damaged' }],
        }),
      ],
    });
    const api = mockApi({
      ...lists,
      'GET /goods-receipts': () => jsonResponse(200, [summary(current)]),
      [`GET /goods-receipts/${current.id}`]: () => jsonResponse(200, current),
      [`POST /goods-receipts/${current.id}/approve`]: () => {
        current = {
          ...current,
          status: 'posted',
          revision: 4,
          approved: {
            by: { id: PO_APPROVER.id, displayName: 'Demo purchasing approver' },
            at: '2026-10-09T06:00:00.000Z',
          },
          supplierReturn: { id: '00000000-0000-4000-8000-0000000000f9', number: 'RTS-2026-00001' },
          lines: current.lines.map((l) => ({
            ...l,
            lot: { id: 'lot', number: 'GR-2026-00001/1' },
          })),
        };
        return jsonResponse(200, { ...current, postingRefusal: null });
      },
    });
    const view = renderApp('/goods-receipts', { as: PO_APPROVER });
    const u = userEvent.setup();

    const row = within(
      (await screen.findByRole('rowheader', { name: 'GR-2026-00001' })).closest('tr')!,
    );
    expect(row.getByText('นอกเกณฑ์ 1 บรรทัด')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'รับสินค้า' })).toBeNull();
    await u.click(row.getByRole('button', { name: 'เปิดใบรับสินค้า GR-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบรับสินค้า GR-2026-00001/ });
    expect(within(panel).getByText('ผู้รับระบุว่าของเสียหาย')).toBeVisible();
    expect(within(panel).getByText('ไม่รับ 18.000 กิโลกรัม')).toBeVisible();
    expect(await axeViolations()).toEqual([]);

    await u.click(within(panel).getByRole('button', { name: 'อนุมัติและลงบัญชีสต๊อก' }));
    expect(
      await screen.findByText('ลงบัญชี GR-2026-00001 แล้ว ส่วนที่ไม่รับออกใบส่งคืน RTS-2026-00001'),
    ).toBeVisible();
    const approve = api.mock.calls.findIndex(([url]) => String(url).endsWith('/approve'));
    expect(sentBody(api, approve)).toEqual({ revision: 2 });

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/goods-receipts', { as: PO_APPROVER });
    expect(await screen.findByRole('heading', { level: 1, name: 'Goods receipts' })).toBeVisible();
    expect(await screen.findByText('Posted to stock')).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('never offers the approval to the person who recorded the receipt', async () => {
    const own = receipt({
      createdBy: { id: PO_APPROVER.id, displayName: 'Demo purchasing approver' },
    });
    mockApi({
      ...lists,
      'GET /goods-receipts': () => jsonResponse(200, [summary(own)]),
      [`GET /goods-receipts/${own.id}`]: () => jsonResponse(200, own),
    });
    renderApp('/goods-receipts', { as: PO_APPROVER });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'เปิดใบรับสินค้า GR-2026-00001' }));
    const panel = await screen.findByRole('region', { name: /ใบรับสินค้า GR-2026-00001/ });
    expect(within(panel).queryByRole('button', { name: 'อนุมัติและลงบัญชีสต๊อก' })).toBeNull();
    expect(within(panel).getByText(/คุณเป็นผู้บันทึกใบรับสินค้านี้/)).toBeVisible();
  });
});

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  axeViolations,
  jsonResponse,
  mockApi,
  PLANT,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import type { UnitView } from '@/features/items/items.api';
import type {
  OrderItemRef,
  ProductionOrderSummary,
  ProductionOrderView,
} from './production-orders.api';

const UNITS: UnitView[] = [
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 },
];

const WHOLE: OrderItemRef = {
  id: '00000000-0000-4000-8000-0000000000e1',
  code: 'WHOLE-CHICKEN',
  nameTh: 'ไก่ทั้งตัว',
  nameEn: 'Whole chicken',
  baseUnitCode: 'kg',
  variableWeight: true,
  weighed: false,
};
const BREAST: OrderItemRef = {
  id: '00000000-0000-4000-8000-0000000000e2',
  code: 'CHICKEN-BREAST',
  nameTh: 'อกไก่',
  nameEn: 'Chicken breast',
  baseUnitCode: 'piece',
  variableWeight: false,
  weighed: true,
};

const PERSON = { id: PLANT.id, displayName: 'Demo plant' };
const LOT_OLD = '00000000-0000-4000-8000-0000000000a1';
const LOT_A = '00000000-0000-4000-8000-0000000000a2';

const RELEASED: ProductionOrderView = {
  id: '00000000-0000-4000-8000-0000000000d1',
  number: 'MO-2026-00002',
  status: 'released',
  businessDate: '2026-10-10',
  note: null,
  revision: 2,
  createdBy: PERSON,
  createdAt: '2026-10-10T02:00:00.000Z',
  postedBy: null,
  postedAt: null,
  reversedBy: null,
  bom: {
    id: '00000000-0000-4000-8000-0000000000b1',
    code: 'CUT-WHOLE-CHICKEN',
    nameTh: 'ตัดแต่งไก่ทั้งตัว',
    nameEn: 'Cut whole chicken',
    version: { id: '00000000-0000-4000-8000-0000000000c1', number: 1, effectiveFrom: '2026-10-09' },
  },
  location: {
    id: '00000000-0000-4000-8000-0000000000f1',
    code: 'PLANT-01',
    nameTh: 'โรงงาน',
    nameEn: 'Plant',
  },
  plannedQuantity: '20.000',
  yield: { expected: '25.00', actual: null, difference: null },
  released: { by: PERSON, at: '2026-10-10T02:05:00.000Z' },
  cancelled: null,
  inputs: [
    {
      lineNo: 1,
      item: WHOLE,
      plannedQuantity: '20.000',
      picks: [
        {
          lotId: LOT_A,
          number: 'GR-2026-00001/1',
          expiryDate: '2026-10-13',
          quantity: '20',
          pieces: null,
          unitCost: '64.2',
          value: '1284',
        },
      ],
      picksOverridden: false,
      shortBy: '0',
      quantity: '20',
      weightKg: null,
      availableLots: [
        {
          lotId: LOT_OLD,
          number: 'OB-2026-00001/3',
          expiryDate: '2026-10-09',
          expired: true,
          unitCost: '72.5',
          available: '4',
          availablePieces: '2',
        },
        {
          lotId: LOT_A,
          number: 'GR-2026-00001/1',
          expiryDate: '2026-10-13',
          expired: false,
          unitCost: '64.2',
          available: '238.4',
          availablePieces: '132',
        },
      ],
    },
  ],
  outputs: [
    {
      lineNo: 1,
      item: BREAST,
      plannedQuantity: '22',
      allocationRatio: '100.00',
      actualQuantity: null,
      actualPieces: null,
      actualWeightKg: null,
      yield: { expected: '25.00', actual: null, difference: null },
      cost: null,
      expiry: {
        expiryDate: '2026-10-13',
        computedExpiryDate: '2026-10-14',
        earliestInputExpiryDate: '2026-10-13',
      },
      lot: null,
    },
  ],
  inputValue: '1284',
  blockers: [{ rule: 'actuals_missing', side: 'output', lineNo: 1 }],
  genealogy: [],
};

const RECORDED: ProductionOrderView = {
  ...RELEASED,
  revision: 3,
  yield: { expected: '25.00', actual: '24.00', difference: '-1.00' },
  outputs: [
    {
      ...RELEASED.outputs[0],
      actualQuantity: '21',
      actualWeightKg: '4.8',
      yield: { expected: '25.00', actual: '24.00', difference: '-1.00' },
      cost: {
        allocatedValue: '1284',
        unitCost: '61.142857',
        lotValue: '1283.999997',
        roundingDifference: '0.000003',
      },
    },
  ],
  blockers: [],
};

const POSTED: ProductionOrderView = {
  ...RECORDED,
  status: 'posted',
  revision: 4,
  postedBy: PERSON,
  postedAt: '2026-10-10T03:00:00.000Z',
  outputs: [{ ...RECORDED.outputs[0], lot: { id: LOT_OLD, number: 'MO-2026-00002/2' } }],
  genealogy: [
    {
      document: { id: RELEASED.id, number: RELEASED.number },
      outputLot: { id: 'x', number: 'MO-2026-00002/2', itemId: BREAST.id },
      inputLot: { id: LOT_A, number: 'GR-2026-00001/1', itemId: WHOLE.id },
      inputQuantity: '20',
      reversed: false,
    },
  ],
};

const summary = (order: ProductionOrderView): ProductionOrderSummary => ({
  ...order,
  plannedItem: WHOLE,
});

const READER = { ...STAFF, permissions: ['production_order:read'] };

describe('production orders (#13)', () => {
  it('lets the plant record actuals, see yield and cost, and post', async () => {
    let current = RELEASED;
    const fetchMock = mockApi({
      'GET /production-orders': () => jsonResponse(200, [summary(current)]),
      [`GET /production-orders/${RELEASED.id}`]: () => jsonResponse(200, current),
      'GET /units': () => jsonResponse(200, UNITS),
      [`PUT /production-orders/${RELEASED.id}/actuals`]: () => {
        current = RECORDED;
        return jsonResponse(200, RECORDED);
      },
      [`POST /production-orders/${RELEASED.id}/post`]: () => {
        current = POSTED;
        return jsonResponse(200, POSTED);
      },
    });
    renderApp('/production-orders', { as: PLANT });
    const u = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'ใบสั่งผลิต' })).toBeVisible();
    await u.click(await screen.findByRole('button', { name: 'เปิดใบสั่งผลิต MO-2026-00002' }));

    // The expired lot is shown, marked, and has nowhere to type a quantity.
    expect(await screen.findByText('หมดอายุ ใช้ไม่ได้')).toBeVisible();
    expect(screen.queryByLabelText('จำนวนที่ใช้จาก lot OB-2026-00001/3')).toBeNull();
    expect(screen.getByLabelText('จำนวนที่ใช้จาก lot GR-2026-00001/1')).toHaveValue('20');
    expect(screen.getByText('ยังไม่ได้บันทึกผลจริงของผลผลิตบางรายการ')).toBeVisible();
    expect(screen.getByRole('button', { name: 'post ใบสั่งผลิต' })).toBeDisabled();

    await u.type(screen.getByLabelText('จำนวนตัวที่ใช้จาก lot GR-2026-00001/1'), '11');
    await u.type(screen.getByLabelText('จำนวน · CHICKEN-BREAST'), '21');
    await u.type(screen.getByLabelText('น้ำหนักที่ชั่งได้ (กก.) · CHICKEN-BREAST'), '4.8');
    await u.click(screen.getByRole('button', { name: 'บันทึก lot และผลจริง' }));

    expect(
      await screen.findByText('24.00% จากที่คาด 25.00%', { selector: 'dd span' }),
    ).toBeVisible();
    const put = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'PUT');
    expect(sentBody(fetchMock, put)).toEqual({
      revision: 2,
      inputs: [
        { lineNo: 1, picks: [{ lotId: LOT_A, quantity: '20', pieces: '11' }], weightKg: null },
      ],
      outputs: [{ lineNo: 1, quantity: '21', pieces: null, weightKg: '4.8' }],
    });
    const outputs = screen.getByRole('table', { name: 'ผลผลิตของใบสั่งผลิต MO-2026-00002' });
    expect(within(outputs).getByText('61.142857 ต่อชิ้น')).toBeVisible();
    expect(within(outputs).getByText('ส่วนต่างจากการปัดเศษ 0.000003')).toBeVisible();
    expect(screen.getByText('พร้อม post แล้ว')).toBeVisible();

    await u.click(screen.getByRole('button', { name: 'post ใบสั่งผลิต' }));
    expect(
      await screen.findByText(
        'post MO-2026-00002 แล้ว lot ผลผลิตเข้าสต๊อกพร้อมผังความสัมพันธ์ lot',
      ),
    ).toBeVisible();
  });

  it('lets finance read a posted order, its costs and genealogy, and change nothing', async () => {
    mockApi({
      'GET /production-orders': () => jsonResponse(200, [summary(POSTED)]),
      [`GET /production-orders/${POSTED.id}`]: () => jsonResponse(200, POSTED),
      'GET /units': () => jsonResponse(200, UNITS),
    });
    renderApp('/production-orders', { as: READER });
    const u = userEvent.setup();

    const row = (await screen.findByRole('rowheader', { name: 'MO-2026-00002' })).closest('tr')!;
    expect(within(row).getByText('24.00% จากที่คาด 25.00%')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'เปิดใบสั่งผลิต' })).toBeNull();

    await u.click(screen.getByRole('button', { name: 'เปิดใบสั่งผลิต MO-2026-00002' }));
    expect(
      await screen.findByText('lot MO-2026-00002/2 มาจาก lot GR-2026-00001/1 (ใช้ไป 20)'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'กลับรายการ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'post ใบสั่งผลิต' })).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });
});

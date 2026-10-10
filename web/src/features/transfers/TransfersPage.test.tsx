// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  axeViolations,
  BRANCH_MANAGER,
  jsonResponse,
  LOGISTICS,
  mockApi,
  PLANT,
  renderApp,
  sentBody,
} from '@/test/render';
import type { UnitView } from '@/features/items/items.api';
import type {
  TransferItemRef,
  TransferReceiptView,
  TransferSummary,
  TransferView,
} from './transfers.api';

const UNITS: UnitView[] = [
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 },
];

const BREAST: TransferItemRef = {
  id: '00000000-0000-4000-8000-0000000000e2',
  code: 'CHICKEN-BREAST',
  nameTh: 'อกไก่',
  nameEn: 'Chicken breast',
  baseUnitCode: 'piece',
  variableWeight: false,
};

const PLANT_01 = {
  id: '00000000-0000-4000-8000-0000000000f1',
  code: 'PLANT-01',
  type: 'plant',
  nameTh: 'โรงงานบางนา',
  nameEn: 'Bang Na plant',
};
const SILOM = {
  id: '00000000-0000-4000-8000-0000000000f2',
  code: 'BR-SILOM',
  type: 'branch',
  nameTh: 'สาขาสีลม',
  nameEn: 'Silom branch',
};
const IN_TRANSIT = {
  id: '00000000-0000-4000-8000-0000000000f3',
  code: 'IN-TRANSIT:PLANT-01',
  type: 'in_transit',
  nameTh: 'ระหว่างขนส่งจาก โรงงานบางนา',
  nameEn: 'In transit from Bang Na plant',
};

const PERSON = { id: LOGISTICS.id, displayName: 'Demo logistics' };
const MANAGER = { id: BRANCH_MANAGER.id, displayName: 'Demo branch manager' };
const LOT_OLD = '00000000-0000-4000-8000-0000000000a1';
const LOT_MO = '00000000-0000-4000-8000-0000000000a2';

const DRAFT: TransferView = {
  id: '00000000-0000-4000-8000-0000000000d1',
  number: 'TR-2026-00004',
  status: 'draft',
  businessDate: '2026-10-10',
  note: null,
  revision: 1,
  createdBy: PERSON,
  createdAt: '2026-10-10T02:00:00.000Z',
  origin: PLANT_01,
  destination: SILOM,
  inTransit: IN_TRANSIT,
  dispatched: null,
  cancelled: null,
  received: null,
  lines: [
    {
      lineNo: 1,
      item: BREAST,
      quantity: '20',
      picks: [
        {
          pickNo: null,
          lotId: LOT_MO,
          number: 'MO-2026-00001/6',
          expiryDate: '2026-10-11',
          unitCost: '23.65125',
          quantity: '20',
          pieces: null,
          outcome: null,
        },
      ],
      dispatched: '20',
      shortBy: '0',
      availableLots: [
        {
          lotId: LOT_OLD,
          number: 'OB-2026-00001/4',
          expiryDate: '2026-10-09',
          expired: true,
          unitCost: '22',
          available: '6',
          availablePieces: null,
        },
        {
          lotId: LOT_MO,
          number: 'MO-2026-00001/6',
          expiryDate: '2026-10-11',
          expired: false,
          unitCost: '23.65125',
          available: '100',
          availablePieces: null,
        },
      ],
      accepted: null,
      returned: null,
      writtenOff: null,
    },
  ],
  blockers: [],
  receipts: [],
};

const DISPATCHED: TransferView = {
  ...DRAFT,
  status: 'dispatched',
  revision: 2,
  dispatched: { by: PERSON, at: '2026-10-10T02:10:00.000Z' },
  lines: [
    {
      ...DRAFT.lines[0],
      picks: [{ ...DRAFT.lines[0].picks[0], pickNo: 1, quantity: '18' }],
      dispatched: '18',
      shortBy: null,
      availableLots: [],
    },
  ],
};

const RECEIPT: TransferReceiptView = {
  id: '00000000-0000-4000-8000-0000000000c1',
  number: 'RT-2026-00004',
  status: 'draft',
  businessDate: '2026-10-10',
  note: null,
  revision: 1,
  createdBy: MANAGER,
  createdAt: '2026-10-10T05:00:00.000Z',
  transfer: {
    id: DISPATCHED.id,
    number: DISPATCHED.number,
    status: 'dispatched',
    businessDate: DISPATCHED.businessDate,
    origin: PLANT_01,
    destination: SILOM,
  },
  location: SILOM,
  submitted: null,
  approved: null,
  rejected: null,
  postedBy: null,
  postedAt: null,
  lines: [
    {
      lineNo: 1,
      item: BREAST,
      lot: {
        id: LOT_MO,
        number: 'MO-2026-00001/6',
        expiryDate: '2026-10-11',
        unitCost: '23.65125',
      },
      dispatched: '18',
      dispatchedPieces: null,
      received: '16',
      receivedPieces: null,
      temperature: '3.2',
      condition: 'good',
      accepted: '16',
      acceptedPieces: null,
      returned: '0',
      returnedPieces: null,
      writtenOff: '2',
      writtenOffPieces: null,
      reason: 'Two pieces missing',
      findings: [],
      reasonRequired: true,
      unresolved: '0',
      tolerances: { maxVariancePercent: null, maxTemperature: '4' },
    },
  ],
  needsApproval: true,
  blockers: [],
};

const summary = (transfer: TransferView): TransferSummary => ({
  ...transfer,
  lineCount: transfer.lines.length,
  receivedBy: null,
});

describe('transfers (#14)', () => {
  it('lets logistics dispatch the lots that left, never an expired one', async () => {
    let current = DRAFT;
    const fetchMock = mockApi({
      'GET /transfers': () => jsonResponse(200, [summary(current)]),
      [`GET /transfers/${DRAFT.id}`]: () => jsonResponse(200, current),
      'GET /units': () => jsonResponse(200, UNITS),
      [`POST /transfers/${DRAFT.id}/dispatch`]: () => {
        current = DISPATCHED;
        return jsonResponse(200, DISPATCHED);
      },
    });
    renderApp('/transfers', { as: LOGISTICS });
    const u = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'ใบโอน' })).toBeVisible();
    await u.click(await screen.findByRole('button', { name: 'เปิดใบโอน TR-2026-00004' }));

    expect(await screen.findByText('หมดอายุ ส่งไม่ได้')).toBeVisible();
    expect(screen.queryByLabelText('จำนวนที่ส่งจาก lot OB-2026-00001/4')).toBeNull();
    const take = screen.getByLabelText('จำนวนที่ส่งจาก lot MO-2026-00001/6');
    expect(take).toHaveValue('20');
    expect(screen.getByText('พร้อมแล้ว')).toBeVisible();

    await u.clear(take);
    await u.type(take, '18');
    await u.click(screen.getByRole('button', { name: 'ส่งของ' }));
    expect(await screen.findByText('ส่ง TR-2026-00004 แล้ว ของอยู่ระหว่างขนส่ง')).toBeVisible();
    const post = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, post)).toEqual({
      revision: 1,
      picks: [{ lineNo: 1, lotId: LOT_MO, quantity: '18', pieces: null }],
    });
  });

  it('lets a branch manager record what arrived, writing off what never came', async () => {
    let current = DISPATCHED;
    const fetchMock = mockApi({
      'GET /transfers': () => jsonResponse(200, [summary(current)]),
      [`GET /transfers/${DISPATCHED.id}`]: () => jsonResponse(200, current),
      'GET /units': () => jsonResponse(200, UNITS),
      [`POST /transfers/${DISPATCHED.id}/receipts`]: () => {
        current = {
          ...DISPATCHED,
          receipts: [
            {
              id: RECEIPT.id,
              number: RECEIPT.number,
              status: 'draft',
              businessDate: RECEIPT.businessDate,
              createdBy: MANAGER,
            },
          ],
        };
        return jsonResponse(201, RECEIPT);
      },
      [`GET /transfer-receipts/${RECEIPT.id}`]: () => jsonResponse(200, RECEIPT),
    });
    renderApp('/transfers', { as: BRANCH_MANAGER });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิดใบโอน TR-2026-00004' }));
    await u.click(await screen.findByRole('button', { name: 'บันทึกการรับ' }));

    const received = screen.getByLabelText('มาถึงจริง · MO-2026-00001/6');
    expect(received).toHaveValue('18');
    await u.clear(received);
    await u.type(received, '16');
    // What is accepted follows what arrived; the two that never came are written off.
    expect(screen.getByLabelText('รับเข้า · MO-2026-00001/6')).toHaveValue('16');
    expect(screen.getByText('ตัดจำหน่าย 2 ชิ้น')).toBeVisible();
    await u.type(screen.getByLabelText('อุณหภูมิ (°C) · MO-2026-00001/6'), '3.2');
    await u.type(screen.getByLabelText('เหตุผล · MO-2026-00001/6'), 'Two pieces missing');
    expect(await axeViolations()).toEqual([]);
    await u.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(await screen.findByText('ส่งให้โรงงานอนุมัติ')).toBeVisible();
    const post = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, post)).toEqual({
      lines: [
        {
          lineNo: 1,
          received: '16',
          receivedPieces: null,
          temperature: '3.2',
          condition: 'good',
          accepted: '16',
          acceptedPieces: null,
          returned: '0',
          returnedPieces: null,
          writtenOff: '2',
          writtenOffPieces: null,
          reason: 'Two pieces missing',
        },
      ],
    });
  });

  it('lets the plant approve a receipt someone else recorded, which receives it', async () => {
    const submitted: TransferReceiptView = {
      ...RECEIPT,
      status: 'submitted',
      revision: 2,
      submitted: { by: MANAGER, at: '2026-10-10T05:01:00.000Z' },
    };
    const transfer: TransferView = {
      ...DISPATCHED,
      receipts: [
        {
          id: RECEIPT.id,
          number: RECEIPT.number,
          status: 'submitted',
          businessDate: RECEIPT.businessDate,
          createdBy: MANAGER,
        },
      ],
    };
    const fetchMock = mockApi({
      'GET /transfers': () => jsonResponse(200, [summary(transfer)]),
      [`GET /transfers/${DISPATCHED.id}`]: () => jsonResponse(200, transfer),
      'GET /units': () => jsonResponse(200, UNITS),
      [`GET /transfer-receipts/${RECEIPT.id}`]: () => jsonResponse(200, submitted),
      [`POST /transfer-receipts/${RECEIPT.id}/approve`]: () =>
        jsonResponse(200, { ...submitted, status: 'posted', revision: 4, postingRefusal: null }),
    });
    renderApp('/transfers', { as: PLANT });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิดใบโอน TR-2026-00004' }));
    await u.click(await screen.findByRole('button', { name: 'เปิดใบรับโอน RT-2026-00004' }));
    const card = (await screen.findByText('Two pieces missing')).closest('li')!;
    expect(within(card).getByText(/ตัดจำหน่าย 2/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'บันทึกการรับ' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'อนุมัติและรับเข้า' }));
    expect(
      await screen.findByText(
        'รับเข้า RT-2026-00004 แล้ว ใบโอน TR-2026-00004 ไม่มีของค้างระหว่างขนส่ง',
      ),
    ).toBeVisible();
    const approve = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, approve)).toEqual({ revision: 2 });
  });
});

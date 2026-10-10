// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADMIN,
  axeViolations,
  BRANCH_MANAGER,
  jsonResponse,
  LOGISTICS,
  mockApi,
  renderApp,
  sentBody,
} from '@/test/render';
import type { UnitView } from '@/features/items/items.api';
import type { LocationView } from '@/features/locations/locations.api';
import type {
  ParLevelView,
  ParMissesView,
  RequisitionItemRef,
  RequisitionSummary,
  RequisitionView,
  SuggestionsView,
} from './requisitions.api';

const UNITS: UnitView[] = [{ code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 }];

const BREAST: RequisitionItemRef = {
  id: '00000000-0000-4000-8000-0000000000e2',
  code: 'CHICKEN-BREAST',
  nameTh: 'อกไก่',
  nameEn: 'Chicken breast',
  baseUnitCode: 'piece',
  variableWeight: false,
  requisitionUnit: '10',
};

const location = (id: string, code: string, type: string, nameTh: string): LocationView =>
  ({
    id,
    code,
    type,
    nameTh,
    nameEn: code,
    active: true,
  }) as LocationView;

const PLANT_01 = location('00000000-0000-4000-8000-0000000000f1', 'PLANT-01', 'plant', 'โรงงาน');
const SILOM = location('00000000-0000-4000-8000-0000000000f2', 'BR-SILOM', 'branch', 'สาขาสีลม');

const PERSON = { id: BRANCH_MANAGER.id, displayName: 'Demo branch manager' };

const SUBMITTED: RequisitionView = {
  id: '00000000-0000-4000-8000-0000000000c1',
  number: 'RQ-2026-00004',
  status: 'submitted',
  revision: 2,
  branch: SILOM,
  supplyingLocation: PLANT_01,
  neededBy: '2026-10-11',
  note: null,
  createdBy: PERSON,
  createdAt: '2026-10-10T02:00:00.000Z',
  submittedAt: '2026-10-10T02:01:00.000Z',
  lines: [
    {
      lineNo: 1,
      item: BREAST,
      suggested: '20',
      requested: '30',
      dispatched: '0',
      drafted: '0',
      outstanding: '30',
    },
  ],
  transfers: [],
  submitted: { by: PERSON, at: '2026-10-10T02:01:00.000Z' },
  cancelled: null,
};

const summary = (r: RequisitionView): RequisitionSummary => ({
  id: r.id,
  number: r.number,
  status: r.status,
  revision: r.revision,
  branch: r.branch,
  supplyingLocation: r.supplyingLocation,
  neededBy: r.neededBy,
  lineCount: r.lines.length,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  submittedAt: r.submittedAt,
});

const SUGGESTIONS: SuggestionsView = {
  branch: SILOM,
  items: [{ item: BREAST, par: '40', balance: '12', inTransit: '10', suggested: '20' }],
};

describe('requisitions (#15)', () => {
  it('lets a branch manager ask for what the screen suggests, changed where they know better', async () => {
    const fetchMock = mockApi({
      'GET /requisitions': () => jsonResponse(200, []),
      'GET /locations': () => jsonResponse(200, [PLANT_01, SILOM]),
      'GET /items': () => jsonResponse(200, []),
      'GET /units': () => jsonResponse(200, UNITS),
      'GET /requisitions/suggestions': (_init, url) => {
        expect(url.searchParams.get('branchId')).toBe(SILOM.id);
        return jsonResponse(200, SUGGESTIONS);
      },
      'POST /requisitions': () =>
        jsonResponse(201, { ...SUBMITTED, status: 'draft', revision: 1, submitted: null }),
      [`POST /requisitions/${SUBMITTED.id}/submit`]: () => jsonResponse(200, SUBMITTED),
      [`GET /requisitions/${SUBMITTED.id}`]: () => jsonResponse(200, SUBMITTED),
    });
    renderApp('/requisitions', { as: BRANCH_MANAGER });
    const u = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'ใบขอเบิก' })).toBeVisible();
    await u.click(screen.getByRole('button', { name: 'ขอเบิกของ' }));
    await u.selectOptions(await screen.findByLabelText('สาขา'), SILOM.id);

    const requested = await screen.findByLabelText('จำนวนที่ขอของ อกไก่');
    expect(requested).toHaveValue('20');
    expect(screen.getByText(/ขอทีละ 10 ชิ้น/)).toBeVisible();
    expect(await axeViolations()).toEqual([]);

    await u.clear(requested);
    await u.type(requested, '30');
    await u.click(screen.getByRole('button', { name: 'ส่งใบขอเบิก' }));
    expect(await screen.findByText('ส่ง RQ-2026-00004 ให้โรงงานแล้ว')).toBeVisible();

    const create = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, create)).toMatchObject({
      branchId: SILOM.id,
      lines: [{ itemId: BREAST.id, requested: '30' }],
    });
    expect(sentBody(fetchMock, create + 1)).toEqual({ revision: 1 });
  });

  it('shows logistics its queue and creates a transfer for what is outstanding', async () => {
    const fetchMock = mockApi({
      'GET /requisitions': (_init, url) => {
        expect(url.searchParams.get('status')).toBe('open');
        return jsonResponse(200, [summary(SUBMITTED)]);
      },
      [`GET /requisitions/${SUBMITTED.id}`]: () => jsonResponse(200, SUBMITTED),
      'GET /units': () => jsonResponse(200, UNITS),
      [`POST /requisitions/${SUBMITTED.id}/transfers`]: () =>
        jsonResponse(201, { id: '00000000-0000-4000-8000-0000000000d9', number: 'TR-2026-00009' }),
    });
    renderApp('/requisitions', { as: LOGISTICS });
    const u = userEvent.setup();

    expect(screen.queryByRole('button', { name: 'ขอเบิกของ' })).toBeNull();
    await u.click(await screen.findByRole('button', { name: 'เปิดใบขอเบิก RQ-2026-00004' }));
    expect(await screen.findByRole('cell', { name: '30 ชิ้น' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ยกเลิกใบขอเบิก' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'สร้างใบโอนจากที่ยังค้าง' }));
    expect(
      await screen.findByText(/สร้างร่างใบโอน TR-2026-00009 จาก RQ-2026-00004 แล้ว/),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'ไปที่ใบโอน' })).toHaveAttribute('href', '/transfers');
    const post = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(fetchMock, post)).toEqual({ revision: 2 });
  });

  it('explains a requisition a draft transfer is still being prepared for', async () => {
    mockApi({
      'GET /requisitions': () => jsonResponse(200, [summary(SUBMITTED)]),
      [`GET /requisitions/${SUBMITTED.id}`]: () => jsonResponse(200, SUBMITTED),
      'GET /units': () => jsonResponse(200, UNITS),
      [`POST /requisitions/${SUBMITTED.id}/cancel`]: () =>
        jsonResponse(422, {
          code: 'REQUISITION_HAS_DRAFT_TRANSFER',
          message: 'x',
          details: { transfer: 'TR-2026-00009' },
        }),
    });
    renderApp('/requisitions', { as: BRANCH_MANAGER });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'เปิดใบขอเบิก RQ-2026-00004' }));
    await u.type(await screen.findByLabelText('เหตุผลที่ยกเลิก'), 'Not needed');
    await u.click(screen.getByRole('button', { name: 'ยกเลิกใบขอเบิก' }));
    expect(
      await screen.findByText(
        'ฝ่ายขนส่งกำลังเตรียมใบโอน TR-2026-00009 ของใบนี้อยู่ ต้องให้ฝ่ายขนส่งยกเลิกใบโอนนั้นก่อน',
      ),
    ).toBeVisible();
  });
});

describe('ระดับสต๊อกมาตรฐานs and par misses (#15)', () => {
  const LEVEL: ParLevelView = {
    location: SILOM,
    item: BREAST,
    quantity: '40',
    updatedBy: { id: ADMIN.id, displayName: 'Demo admin' },
    updatedAt: '2026-10-10T02:00:00.000Z',
  };
  const MISSES: ParMissesView = {
    from: '2026-09-13',
    to: '2026-10-10',
    rows: [
      { branch: SILOM, item: BREAST, par: '40', negativeEpisodes: 2, linesDue: 3, linesMissed: 1 },
    ],
  };

  it('shows how often each branch ran short, and lets the admin set a par level', async () => {
    const fetchMock = mockApi({
      'GET /requisitions/par-misses': () => jsonResponse(200, MISSES),
      'GET /par-levels': () => jsonResponse(200, [LEVEL]),
      'GET /locations': () => jsonResponse(200, [PLANT_01, SILOM]),
      'GET /items': () =>
        jsonResponse(200, [
          {
            ...BREAST,
            shelfLifeDays: 3,
            active: true,
            purchaseUnits: [],
            receivingTolerances: { maxVariancePercent: null, maxTemperature: null },
            version: 1,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        ]),
      'GET /units': () => jsonResponse(200, UNITS),
      [`PUT /par-levels/${SILOM.id}/${BREAST.id}`]: () =>
        jsonResponse(200, { ...LEVEL, quantity: '50' }),
    });
    renderApp('/par-levels', { as: ADMIN });
    const u = userEvent.setup();

    expect(await screen.findByRole('cell', { name: '1 จาก 3 บรรทัด' })).toBeVisible();
    expect(screen.getByRole('cell', { name: '2' })).toBeVisible();
    expect(await screen.findByRole('cell', { name: '40 ชิ้น' })).toBeVisible();

    await u.selectOptions(screen.getByLabelText('สาขา', { selector: '#par-set-branch' }), SILOM.id);
    await u.selectOptions(screen.getByLabelText('สินค้า'), BREAST.id);
    await u.type(screen.getByLabelText('จำนวน (หน่วยนับของสินค้า)'), '50');
    await u.click(screen.getByRole('button', { name: 'บันทึกระดับสต๊อกมาตรฐาน' }));
    const put = () => fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'PUT');
    await vi.waitFor(() => expect(put()).toBeGreaterThanOrEqual(0));
    expect(sentBody(fetchMock, put())).toEqual({ quantity: '50' });
    expect(await axeViolations()).toEqual([]);
  });

  it('leaves the par levels as they are for someone who only reads them', async () => {
    mockApi({
      'GET /requisitions/par-misses': () => jsonResponse(200, MISSES),
      'GET /par-levels': () => jsonResponse(200, [LEVEL]),
      'GET /locations': () => jsonResponse(200, [PLANT_01, SILOM]),
      'GET /items': () => jsonResponse(200, []),
      'GET /units': () => jsonResponse(200, UNITS),
    });
    renderApp('/par-levels', { as: LOGISTICS });
    expect(await screen.findByRole('cell', { name: '40 ชิ้น' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'บันทึกระดับสต๊อกมาตรฐาน' })).toBeNull();
    expect(screen.queryByRole('button', { name: /ลบระดับสต๊อกมาตรฐาน/ })).toBeNull();
  });
});

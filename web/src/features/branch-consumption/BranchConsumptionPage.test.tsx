// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADMIN,
  axeViolations,
  BRANCH_MANAGER,
  jsonResponse,
  mockApi,
  PURCHASING,
  renderApp,
} from '@/test/render';
import type { LocationView } from '@/features/locations/locations.api';
import type {
  ConsumptionSummary,
  ConsumptionView,
  SalesEventProblem,
  UsageRow,
} from './branch-consumption.api';

const SILOM = {
  id: '00000000-0000-4000-8000-0000000000f2',
  code: 'BR-SILOM',
  type: 'branch',
  nameTh: 'สาขาสีลม',
  nameEn: 'Silom branch',
  active: true,
} as LocationView;

const FAILED: SalesEventProblem = {
  salesEventId: '00000000-0000-4000-8000-0000000000a1',
  idempotencyKey: 'POS-SILOM-1-0001',
  posInstanceCode: 'POS-SILOM',
  branch: { id: SILOM.id, code: SILOM.code },
  saleTime: '2026-10-13T05:00:00.000Z',
  receivedAt: '2026-10-13T05:00:02.000Z',
  menuItemCode: 'POPCORN',
  quantity: '1',
  weightKg: null,
  modifiers: [],
  outcome: 'failed',
  reason: 'unknown_menu_item',
  detail: null,
  recordedAt: '2026-10-13T05:00:30.000Z',
  reprocessable: true,
  notReprocessableBecause: null,
};

const HELD: SalesEventProblem = {
  ...FAILED,
  salesEventId: '00000000-0000-4000-8000-0000000000a2',
  idempotencyKey: 'POS-SILOM-1-0002',
  menuItemCode: 'SET-WINGS-6',
  outcome: 'held',
  reason: 'sale_time_ahead',
  reprocessable: false,
  notReprocessableBecause: 'sale_date_not_yet',
};

const DOCUMENT: ConsumptionSummary = {
  documentId: '00000000-0000-4000-8000-0000000000b1',
  number: 'BC-2026-00001',
  saleTime: '2026-10-13T04:00:00.000Z',
  branch: { id: SILOM.id, code: SILOM.code },
  menuItemCode: 'BUCKET-8',
  idempotencyKey: 'POS-SILOM-1-0003',
  shortfall: true,
  consumedExpiredLot: false,
  placeholder: true,
};

const BREAST = {
  id: '00000000-0000-4000-8000-0000000000d1',
  code: 'CHICKEN-BREAST',
  nameTh: 'อกไก่',
  nameEn: 'Chicken breast',
  baseUnitCode: 'piece',
};

const VIEW: ConsumptionView = {
  documentId: DOCUMENT.documentId,
  number: DOCUMENT.number,
  status: 'posted',
  businessDate: '2026-10-13',
  saleTime: DOCUMENT.saleTime,
  branch: SILOM,
  salesEvent: {
    id: FAILED.salesEventId,
    idempotencyKey: DOCUMENT.idempotencyKey,
    posInstanceCode: 'POS-SILOM',
  },
  menuItem: { id: 'm1', code: 'BUCKET-8', nameTh: 'ไก่ทอดถัง 8 ชิ้น', nameEn: 'Bucket of eight' },
  recipeEffectiveFrom: '2026-10-01',
  shortfall: true,
  consumedExpiredLot: false,
  placeholder: true,
  postedBy: { id: 'auto', displayName: 'PaynEat ERP — automatic' },
  postedAt: '2026-10-13T04:00:30.000Z',
  lines: [
    {
      lineNo: 1,
      item: BREAST,
      usage: '2',
      quantity: '2',
      lots: [
        {
          id: 'l1',
          number: 'PH-BR-SILOM-CHICKEN-BREAST',
          quantity: '2',
          unitCost: '9',
          placeholderCost: 'estimated',
          expired: false,
        },
      ],
    },
  ],
};

const USAGE: UsageRow = {
  date: '2026-10-13',
  branch: SILOM,
  item: BREAST,
  quantity: '2',
  value: '18',
  estimatedCost: true,
  unknownCost: false,
  consumedExpiredLot: false,
};

const routes = (extra: Record<string, () => Response> = {}) => ({
  'GET /locations': () => jsonResponse(200, [SILOM]),
  'GET /branch-consumption/problems': () => jsonResponse(200, [FAILED, HELD]),
  'GET /branch-consumption': () => jsonResponse(200, [DOCUMENT]),
  [`GET /branch-consumption/${DOCUMENT.documentId}`]: () => jsonResponse(200, VIEW),
  'GET /branch-consumption/usage': () => jsonResponse(200, [USAGE]),
  ...extra,
});

describe('branch consumption', () => {
  it('shows failed and held sales, the documents with their lots, and usage with estimates flagged', async () => {
    mockApi(routes());
    renderApp('/branch-consumption', { as: ADMIN });
    const u = userEvent.setup();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'การใช้วัตถุดิบที่สาขา' }),
    ).toBeVisible();
    const problems = await screen.findByRole('region', { name: 'ยอดขายที่ต้องให้คนดู' });
    expect(await within(problems).findByText('ไม่มีเมนูรหัสนี้')).toBeVisible();
    expect(
      within(problems).getByText('ยังไม่ถึงวันขาย ประมวลผลใหม่ได้เมื่อถึงวันนั้น'),
    ).toBeVisible();
    expect(
      within(problems).getByRole('button', { name: 'ประมวลผลยอดขาย POS-SILOM-1-0002 ใหม่' }),
    ).toBeDisabled();

    const documents = screen.getByRole('region', { name: 'เอกสารตัดวัตถุดิบ' });
    await u.click(await within(documents).findByRole('button', { name: 'BC-2026-00001' }));
    expect(await within(documents).findByText('PH-BR-SILOM-CHICKEN-BREAST')).toBeVisible();
    expect(within(documents).getAllByText('ต้นทุนประมาณ').length).toBeGreaterThan(0);
    expect(within(documents).getByText(/PaynEat ERP — automatic/)).toBeVisible();

    const usage = screen.getByRole('region', { name: 'ปริมาณการใช้ตามสูตร' });
    expect(await within(usage).findByText('ต้นทุนประมาณ')).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('lets the admin re-process a failed sale and says what became of it', async () => {
    const api = mockApi(
      routes({
        [`POST /branch-consumption/sales-events/${FAILED.salesEventId}/reprocess`]: () =>
          jsonResponse(201, { problem: null }),
      }),
    );
    renderApp('/branch-consumption', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(
      await screen.findByRole('button', { name: 'ประมวลผลยอดขาย POS-SILOM-1-0001 ใหม่' }),
    );
    expect(await screen.findByText('ยอดขาย POS-SILOM-1-0001 ตัดวัตถุดิบแล้ว')).toBeVisible();
    expect(
      api.mock.calls.some(
        ([url, init]) => init?.method === 'POST' && String(url).includes('/reprocess'),
      ),
    ).toBe(true);
  });

  it('shows a branch manager the problems without the buttons to re-process', async () => {
    mockApi(routes());
    renderApp('/branch-consumption', { as: BRANCH_MANAGER });
    expect(await screen.findByText('ไม่มีเมนูรหัสนี้')).toBeVisible();
    expect(screen.queryByRole('button', { name: /ประมวลผล/ })).toBeNull();
  });

  it('is not in purchasing’s navigation', async () => {
    mockApi({ 'GET /purchase-orders': () => jsonResponse(200, []) });
    renderApp('/purchase-orders', { as: PURCHASING });
    expect(await screen.findByRole('heading', { level: 1, name: 'ใบสั่งซื้อ' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'การใช้วัตถุดิบที่สาขา' })).toBeNull();
  });
});

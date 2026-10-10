// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADMIN,
  axeViolations,
  jsonResponse,
  mockApi,
  PLANT,
  PURCHASING,
  renderApp,
  sentBody,
} from '@/test/render';
import type { ItemView, UnitView } from '@/features/items/items.api';
import type { BomPreview, ProductionBomSummary, ProductionBomView } from './production-boms.api';

const UNITS: UnitView[] = [
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 },
];

const item = (id: string, code: string, nameTh: string, baseUnitCode: string): ItemView => ({
  id,
  code,
  nameTh,
  nameEn: code,
  baseUnitCode,
  variableWeight: false,
  shelfLifeDays: 5,
  receivingTolerances: { maxVariancePercent: null, maxTemperature: null },
  active: true,
  purchaseUnits: [],
  version: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
});
const WHOLE = item('00000000-0000-4000-8000-0000000000e1', 'WHOLE-CHICKEN', 'ไก่ทั้งตัว', 'kg');
const BREAST = item('00000000-0000-4000-8000-0000000000e2', 'CHICKEN-BREAST', 'อกไก่', 'piece');
const FRAME = item('00000000-0000-4000-8000-0000000000e3', 'CHICKEN-FRAME', 'โครงไก่', 'kg');
const ref = ({ id, code, nameTh, nameEn, baseUnitCode }: ItemView) => ({
  id,
  code,
  nameTh,
  nameEn,
  baseUnitCode,
});

const CUT: ProductionBomView = {
  id: '00000000-0000-4000-8000-0000000000b1',
  code: 'CUT-WHOLE-CHICKEN',
  nameTh: 'ตัดแต่งไก่ทั้งตัว',
  nameEn: 'Cut whole chicken',
  locationType: 'plant',
  active: true,
  revision: 1,
  today: '2026-10-10',
  versions: [
    {
      id: '00000000-0000-4000-8000-0000000000c1',
      number: 1,
      effectiveFrom: '2026-10-09',
      status: 'current',
      inputs: [
        { lineNo: 1, item: ref(WHOLE), quantity: '20', expectedWeightKg: null, weightKg: '20.000' },
      ],
      outputs: [
        {
          lineNo: 1,
          item: ref(BREAST),
          quantity: '22',
          expectedWeightKg: '5.000',
          weightKg: '5.000',
          allocationRatio: '70.00',
          yieldPercent: '25.00',
        },
        {
          lineNo: 2,
          item: ref(FRAME),
          quantity: '4.4',
          expectedWeightKg: null,
          weightKg: '4.400',
          allocationRatio: '30.00',
          yieldPercent: '22.00',
        },
      ],
      ratiosOverridden: true,
      inputWeightKg: '20.000',
      outputWeightKg: '9.400',
      wasteKg: '10.600',
      yieldPercent: '47.00',
    },
  ],
};

const SUMMARY: ProductionBomSummary = {
  id: CUT.id,
  code: CUT.code,
  nameTh: CUT.nameTh,
  nameEn: CUT.nameEn,
  locationType: 'plant',
  active: true,
  revision: 1,
  current: { number: 1, effectiveFrom: '2026-10-09', yieldPercent: '47.00' },
  scheduled: null,
};

const PREVIEW: BomPreview = {
  issues: [],
  problems: [],
  figures: {
    inputWeightKg: '20.000',
    outputWeightKg: '9.400',
    wasteKg: '10.600',
    yieldPercent: '47.00',
    outputs: [
      { weightKg: '5.000', yieldPercent: '25.00', defaultRatio: '53.19' },
      { weightKg: '4.400', yieldPercent: '22.00', defaultRatio: '46.81' },
    ],
  },
  statedRatioTotal: null,
};

const api = (overrides: Record<string, (init: RequestInit) => Response> = {}) => ({
  'GET /production-boms': () => jsonResponse(200, [SUMMARY]),
  [`GET /production-boms/${CUT.id}`]: () => jsonResponse(200, CUT),
  'GET /items': () => jsonResponse(200, [WHOLE, BREAST, FRAME]),
  'GET /units': () => jsonResponse(200, UNITS),
  'POST /production-boms/preview': () => jsonResponse(200, PREVIEW),
  ...overrides,
});

/** Fills in the cutting BOM's lines: one input, two outputs, the pieces with a weight. */
async function fillLines(u: ReturnType<typeof userEvent.setup>) {
  await u.selectOptions(await screen.findByLabelText('วัตถุดิบ (บรรทัดที่ 1)'), WHOLE.id);
  await u.type(screen.getByLabelText('ปริมาณเป็นกิโลกรัม (วัตถุดิบบรรทัดที่ 1)'), '20');
  await u.selectOptions(screen.getByLabelText('ผลผลิต (บรรทัดที่ 1)'), BREAST.id);
  await u.type(screen.getByLabelText('ปริมาณที่คาดไว้เป็นชิ้น (ผลผลิตบรรทัดที่ 1)'), '22');
  await u.type(screen.getByLabelText('น้ำหนักที่คาดไว้ กก. (ผลผลิตบรรทัดที่ 1)'), '5');
  await u.click(screen.getByRole('button', { name: 'เพิ่มผลผลิต' }));
  await u.selectOptions(screen.getByLabelText('ผลผลิต (บรรทัดที่ 2)'), FRAME.id);
  await u.type(screen.getByLabelText('ปริมาณที่คาดไว้เป็นกิโลกรัม (ผลผลิตบรรทัดที่ 2)'), '4.4');
}

describe('production BOMs (#12)', () => {
  it('lets the plant read a BOM: yield and cost share per output, waste, no buttons that change it', async () => {
    mockApi(api());
    renderApp('/production-boms', { as: PLANT });
    const u = userEvent.setup();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'สูตรการผลิต (BOM)' }),
    ).toBeVisible();
    const row = (await screen.findByRole('rowheader', { name: /ตัดแต่งไก่ทั้งตัว/ })).closest(
      'tr',
    )!;
    expect(within(row).getByText('47.00 %')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'สร้างสูตรการผลิต' })).toBeNull();

    await u.click(screen.getByRole('button', { name: 'เปิดสูตร ตัดแต่งไก่ทั้งตัว' }));
    const outputs = await screen.findByRole('table', { name: 'ผลผลิตของเวอร์ชัน 1' });
    expect(
      within(outputs)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual([
      'อกไก่CHICKEN-BREAST22 ชิ้น5.00025.00 %70.00 %',
      'โครงไก่CHICKEN-FRAME4.4 กิโลกรัม4.40022.00 %30.00 %',
    ]);
    expect(
      screen.getByText(
        'วัตถุดิบ 20.000 กก. · ผลผลิตที่คาดไว้ 9.400 กก. · ของเสีย 10.600 กก. · อัตราผลได้ 47.00%',
      ),
    ).toBeVisible();
    expect(screen.getByText('สัดส่วนปันต้นทุนกำหนดเอง')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'เพิ่มเวอร์ชันใหม่' })).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it('shows weights, yield and weight-share ratios live while the admin enters a new BOM', async () => {
    const created: ProductionBomView = { ...CUT, id: '00000000-0000-4000-8000-0000000000b2' };
    const fetchMock = mockApi(
      api({ 'POST /production-boms': () => jsonResponse(201, { ...created, code: 'CUT-TEST' }) }),
    );
    renderApp('/production-boms', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'สร้างสูตรการผลิต' }));
    await u.type(screen.getByLabelText('รหัสสูตร'), 'cut-test');
    await u.type(screen.getByLabelText('ชื่อภาษาไทย'), 'ตัดไก่ทดสอบ');
    await u.type(screen.getByLabelText('ชื่อภาษาอังกฤษ'), 'Test cutting');
    await u.type(screen.getByLabelText('เริ่มมีผลวันที่'), '10/10/2569');
    await fillLines(u);

    expect(
      await screen.findByText(
        'วัตถุดิบ 20.000 กก. · ผลผลิตที่คาดไว้ 9.400 กก. · ของเสีย 10.600 กก. · อัตราผลได้ 47.00%',
      ),
    ).toBeVisible();
    expect(
      screen.getByText('5.000 กก. · อัตราผลได้ 25.00% · สัดส่วนตามน้ำหนัก 53.19%'),
    ).toBeVisible();
    expect(
      screen.getByText('4.400 กก. · อัตราผลได้ 22.00% · สัดส่วนตามน้ำหนัก 46.81%'),
    ).toBeVisible();
    // A kg item weighs its quantity: no weight field for the frames.
    expect(screen.queryByLabelText('น้ำหนักที่คาดไว้ กก. (ผลผลิตบรรทัดที่ 2)')).toBeNull();

    await u.click(screen.getByRole('button', { name: 'บันทึกสูตร' }));
    expect(await screen.findByText('สร้างสูตร CUT-TEST แล้ว')).toBeVisible();
    const post = fetchMock.mock.calls.findIndex(
      ([url, init]) => init?.method === 'POST' && String(url).endsWith('/production-boms'),
    );
    expect(sentBody(fetchMock, post)).toEqual({
      code: 'CUT-TEST',
      nameTh: 'ตัดไก่ทดสอบ',
      nameEn: 'Test cutting',
      locationType: 'plant',
      effectiveFrom: '2026-10-10',
      inputs: [{ itemId: WHOLE.id, quantity: '20', expectedWeightKg: null }],
      outputs: [
        { itemId: BREAST.id, quantity: '22', expectedWeightKg: '5', allocationRatio: null },
        { itemId: FRAME.id, quantity: '4.4', expectedWeightKg: null, allocationRatio: null },
      ],
    });
  });

  it('starts overridden ratios from the weight shares and shows what they add up to', async () => {
    const fetchMock = mockApi(
      api({
        'POST /production-boms/preview': (init) => {
          const body = JSON.parse(String(init.body)) as {
            outputs: Array<{ allocationRatio?: string | null }>;
          };
          const stated = body.outputs.some((o) => o.allocationRatio);
          return jsonResponse(200, {
            ...PREVIEW,
            problems: stated ? ['ratios_not_100'] : [],
            statedRatioTotal: stated ? '99.00' : null,
          });
        },
      }),
    );
    renderApp('/production-boms', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'สร้างสูตรการผลิต' }));
    await fillLines(u);
    await screen.findByText('5.000 กก. · อัตราผลได้ 25.00% · สัดส่วนตามน้ำหนัก 53.19%');
    await u.click(screen.getByLabelText('กำหนดสัดส่วนปันต้นทุนเอง'));

    const breast = screen.getByLabelText('สัดส่วนปันต้นทุน % (ผลผลิตบรรทัดที่ 1)');
    expect(breast).toHaveValue('53.19');
    expect(screen.getByLabelText('สัดส่วนปันต้นทุน % (ผลผลิตบรรทัดที่ 2)')).toHaveValue('46.81');
    await u.clear(breast);
    await u.type(breast, '52.19');

    expect(await screen.findByText('สัดส่วนที่ใส่รวม 99.00%')).toBeVisible();
    expect(screen.getByText('สัดส่วนที่กำหนดเองต้องรวมกันได้ 100 พอดี')).toBeVisible();
    await waitFor(() => {
      const previews = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/preview'));
      const last = JSON.parse(String(previews.at(-1)![1]!.body)) as {
        outputs: Array<{ allocationRatio: string | null }>;
      };
      expect(last.outputs.map((o) => o.allocationRatio)).toEqual(['52.19', '46.81']);
    });
  });

  it('marks the line the API refuses when saving', async () => {
    mockApi(
      api({
        'POST /production-boms': () =>
          jsonResponse(422, {
            statusCode: 422,
            code: 'INVALID_PRODUCTION_BOM',
            message: 'output line 1: weight missing',
            details: {
              issues: [{ side: 'output', lineNo: 1, problem: 'weight_missing' }],
              problems: [],
            },
          }),
      }),
    );
    renderApp('/production-boms', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'สร้างสูตรการผลิต' }));
    await u.type(screen.getByLabelText('รหัสสูตร'), 'CUT-X');
    await u.type(screen.getByLabelText('ชื่อภาษาไทย'), 'ตัดไก่');
    await u.type(screen.getByLabelText('ชื่อภาษาอังกฤษ'), 'Cutting');
    await u.type(screen.getByLabelText('เริ่มมีผลวันที่'), '10/10/2569');
    await fillLines(u);
    await u.click(screen.getByRole('button', { name: 'บันทึกสูตร' }));

    expect(
      await screen.findByText(
        'บรรทัดที่ 1: สินค้านี้ไม่ได้นับเป็นกิโลกรัม ต้องใส่น้ำหนักที่คาดไว้',
      ),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('บางบรรทัดไม่ถูกต้อง ดูที่แต่ละบรรทัด');
  });

  it('adds a version starting from the one in force', async () => {
    const fetchMock = mockApi(
      api({
        [`POST /production-boms/${CUT.id}/versions`]: () =>
          jsonResponse(201, {
            ...CUT,
            versions: [
              {
                ...CUT.versions[0],
                id: 'v2',
                number: 2,
                effectiveFrom: '2026-10-12',
                status: 'scheduled',
              },
              ...CUT.versions,
            ],
          }),
      }),
    );
    renderApp('/production-boms', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เปิดสูตร ตัดแต่งไก่ทั้งตัว' }));
    await u.click(await screen.findByRole('button', { name: 'เพิ่มเวอร์ชันใหม่' }));
    expect(screen.getByLabelText('สัดส่วนปันต้นทุน % (ผลผลิตบรรทัดที่ 1)')).toHaveValue('70.00');
    await u.type(screen.getByLabelText('เริ่มมีผลวันที่'), '12/10/2569');
    await u.click(screen.getByRole('button', { name: 'บันทึกเวอร์ชันใหม่' }));

    expect(await screen.findByText('เพิ่มเวอร์ชัน 2 ของ CUT-WHOLE-CHICKEN แล้ว')).toBeVisible();
    const post = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith('/versions'));
    expect(sentBody(fetchMock, post)).toMatchObject({
      effectiveFrom: '2026-10-12',
      outputs: [
        { itemId: BREAST.id, allocationRatio: '70.00' },
        { itemId: FRAME.id, allocationRatio: '30.00' },
      ],
    });
  });

  it('keeps BOMs out of the navigation of roles that may not read them', async () => {
    mockApi({ 'GET /purchase-orders': () => jsonResponse(200, []) });
    renderApp('/production-boms', { as: PURCHASING });
    expect(await screen.findByRole('navigation')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'สูตรการผลิต (BOM)' })).toBeNull();
  });
});

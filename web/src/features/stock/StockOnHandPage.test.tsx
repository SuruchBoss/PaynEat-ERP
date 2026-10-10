// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import { axeViolations, jsonResponse, mockApi, renderApp, STAFF } from '@/test/render';
import type { StockOnHandRow, StockOnHandView } from './stock.api';

const UNITS = [
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 },
];
const PLANT = {
  id: '00000000-0000-4000-8000-0000000000a1',
  code: 'PLANT-01',
  type: 'plant' as const,
  nameTh: 'โรงงานบางนา',
  nameEn: 'Bang Na plant',
};
const BRANCH = {
  id: '00000000-0000-4000-8000-0000000000a2',
  code: 'BR-SILOM',
  type: 'branch' as const,
  nameTh: 'สาขาสีลม',
  nameEn: 'Silom branch',
};

const row = (overrides: Partial<StockOnHandRow>): StockOnHandRow => ({
  item: {
    id: '00000000-0000-4000-8000-0000000000b1',
    code: 'WHOLE-CHICKEN',
    nameTh: 'ไก่ทั้งตัว',
    nameEn: 'Whole chicken',
    baseUnitCode: 'kg',
  },
  lot: {
    id: '00000000-0000-4000-8000-0000000000c1',
    placeholderCost: null,
    number: 'OB-2026-00001/3',
    expiryDate: '2026-09-27',
  },
  location: PLANT,
  quantity: '21.600',
  secondaryQuantity: '12',
  unitCost: '72.5',
  value: '1566',
  expired: false,
  countRecommended: false,
  ...overrides,
});

const TODAY: StockOnHandView = {
  asOf: '2026-09-26',
  totalValue: '9328.5',
  rows: [
    row({
      item: {
        id: '00000000-0000-4000-8000-0000000000b2',
        code: 'FLOUR',
        nameTh: 'แป้งชุบทอด',
        nameEn: 'Batter flour',
        baseUnitCode: 'kg',
      },
      lot: {
        id: '00000000-0000-4000-8000-0000000000c2',
        placeholderCost: null,
        number: 'OB-2026-00001/1',
        expiryDate: '2027-02-23',
      },
      quantity: '250.000',
      secondaryQuantity: null,
      unitCost: '32.5',
      value: '8125',
    }),
    row({ expired: true }),
    row({
      location: BRANCH,
      lot: {
        id: '00000000-0000-4000-8000-0000000000c3',
        placeholderCost: null,
        number: 'OB-2026-00002/1',
        expiryDate: '2026-09-28',
      },
      quantity: '-5.000',
      secondaryQuantity: null,
      value: '-362.5',
      countRecommended: true,
    }),
  ],
  negativeBranchBalances: 1,
};

const lists = {
  'GET /locations': () => jsonResponse(200, [PLANT, BRANCH]),
  'GET /items': () => jsonResponse(200, []),
  'GET /units': () => jsonResponse(200, UNITS),
};

describe('stock on hand', () => {
  it('shows every lot with its figures exactly, flags expired and negative ones, and passes axe', async () => {
    mockApi({ ...lists, 'GET /stock-on-hand': () => jsonResponse(200, TODAY) });
    const view = renderApp('/stock', { as: STAFF });

    expect(await screen.findByRole('heading', { level: 1, name: 'สต๊อกคงเหลือ' })).toBeVisible();
    const flour = within(
      (await screen.findByRole('rowheader', { name: /แป้งชุบทอด/ })).closest('tr')!,
    );
    expect(flour.getByText('250.000 กิโลกรัม')).toBeVisible();
    expect(flour.getByText('8,125')).toBeVisible();
    expect(flour.getByText('–')).toBeVisible();

    const chickens = screen.getAllByRole('rowheader', { name: /ไก่ทั้งตัว/ });
    const expired = within(chickens[0].closest('tr')!);
    expect(expired.getByText('หมดอายุแล้ว')).toBeVisible();
    expect(expired.getByText('12 ชิ้น')).toBeVisible();
    const negative = within(chickens[1].closest('tr')!);
    expect(negative.getByText('ติดลบ ควรตรวจนับ')).toBeVisible();
    expect(negative.getByText('-362.5')).toBeVisible();
    expect(screen.getByText(/1 lot ที่สาขาติดลบ ควรตรวจนับ/)).toBeVisible();

    expect(screen.getByText('9,328.5')).toBeVisible();
    expect(screen.getByText(/3 รายการ มูลค่ารวม 9,328.5 บาท/)).toBeVisible();
    expect(await axeViolations()).toEqual([]);

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/stock', { as: STAFF });
    expect(await screen.findByText('250.000 kilogram')).toBeVisible();
    expect(screen.getByText('Expired')).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('asks again for another date and location, and explains a date still to come', async () => {
    const seen: string[] = [];
    mockApi({
      ...lists,
      'GET /stock-on-hand': (_init, url) => {
        seen.push(url.search);
        if (url.searchParams.get('asOf') === '2030-01-01') {
          return jsonResponse(422, { code: 'AS_OF_IN_FUTURE', message: 'x' });
        }
        return jsonResponse(200, {
          asOf: url.searchParams.get('asOf') ?? '2026-09-26',
          rows: [],
          totalValue: '0',
          negativeBranchBalances: 0,
        });
      },
    });
    renderApp('/stock', { as: STAFF });
    const u = userEvent.setup();

    expect(await screen.findByText('ไม่มีสต๊อกที่ตรงกับเงื่อนไขนี้ ณ วันที่เลือก')).toBeVisible();
    await u.selectOptions(await screen.findByLabelText('สถานที่'), 'BR-SILOM · สาขาสีลม');
    await u.type(screen.getByLabelText('ณ วันที่'), '20/9/2569');
    await screen.findByText(/20 ก.ย. 2569/);
    expect(seen.map((search) => Object.fromEntries(new URLSearchParams(search)))).toContainEqual({
      asOf: '2026-09-20',
      locationId: BRANCH.id,
    });

    await u.clear(screen.getByLabelText('ณ วันที่'));
    await u.type(screen.getByLabelText('ณ วันที่'), '1/1/2573');
    expect(
      await screen.findByText('ดูสต๊อกได้ถึงวันนี้เท่านั้น เลือกวันที่ไม่เกินวันนี้'),
    ).toBeVisible();
  });

  it('breaks stock in transit down by transfer (#14)', async () => {
    const inTransit = {
      id: '00000000-0000-4000-8000-0000000000a3',
      code: 'IN-TRANSIT:PLANT-01',
      type: 'in_transit' as const,
      nameTh: 'ระหว่างขนส่งจาก โรงงานบางนา',
      nameEn: 'In transit from Bang Na plant',
    };
    const view: StockOnHandView = {
      asOf: '2026-09-26',
      totalValue: '1566',
      rows: [row({ location: inTransit })],
      negativeBranchBalances: 0,
    };
    let asked = 0;
    mockApi({
      ...lists,
      'GET /stock-on-hand': () => jsonResponse(200, view),
      'GET /transfers/in-transit': () => {
        asked += 1;
        return jsonResponse(200, {
          asOf: '2026-09-26',
          transfers: [
            {
              transfer: { id: 'x', number: 'TR-2026-00001', businessDate: '2026-09-26' },
              origin: PLANT,
              destination: BRANCH,
              inTransit,
              lots: [
                {
                  item: { ...row({}).item, variableWeight: true },
                  lot: row({}).lot,
                  quantity: '21.6',
                  pieces: '12',
                },
              ],
            },
          ],
        });
      },
    });
    renderApp('/stock', { as: STAFF });

    expect(await screen.findByRole('heading', { name: 'ระหว่างขนส่ง แยกตามใบโอน' })).toBeVisible();
    expect(screen.getByText('TR-2026-00001 · PLANT-01 → BR-SILOM')).toBeVisible();
    expect(asked).toBe(1);
  });
});

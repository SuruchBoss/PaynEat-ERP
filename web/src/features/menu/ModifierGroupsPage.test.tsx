// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADMIN,
  axeViolations,
  jsonResponse,
  MENU_READER,
  mockApi,
  renderApp,
  sentBody,
} from '@/test/render';
import type { ModifierGroupView, RecipeView } from './menu.api';

const SAUCE: ModifierGroupView = {
  id: '00000000-0000-4000-8000-0000000000a1',
  code: 'SAUCE',
  nameTh: 'น้ำจิ้ม',
  nameEn: 'Sauce',
  minSelections: 0,
  maxSelections: 1,
  active: true,
  version: 7,
  options: [
    {
      id: '00000000-0000-4000-8000-0000000000e1',
      code: 'SAUCE-HOT',
      nameTh: 'เพิ่มน้ำจิ้มเผ็ด',
      nameEn: 'Extra hot sauce',
      priceChange: '10',
      active: true,
    },
    {
      id: '00000000-0000-4000-8000-0000000000e2',
      code: 'NO-SAUCE',
      nameTh: 'ไม่รับน้ำจิ้ม',
      nameEn: 'No sauce',
      priceChange: '0',
      active: true,
    },
  ],
};

const NO_SAUCE_RECIPE: RecipeView = {
  subject: {
    kind: 'modifier',
    id: SAUCE.options[1].id,
    code: 'NO-SAUCE',
    nameTh: 'ไม่รับน้ำจิ้ม',
    nameEn: 'No sauce',
    per: 'unit_sold',
  },
  today: '2026-10-02',
  versions: [
    {
      id: '00000000-0000-4000-8000-0000000000d9',
      number: 1,
      effectiveFrom: '2026-10-01',
      status: 'current',
      lines: [
        {
          lineNo: 1,
          item: {
            id: '00000000-0000-4000-8000-0000000000f9',
            code: 'DIPPING-SAUCE',
            nameTh: 'น้ำจิ้มไก่ (ถ้วย)',
            nameEn: 'Dipping sauce (cup)',
            baseUnitCode: 'piece',
          },
          quantity: '-1',
          unitCost: null,
          costLot: null,
          cost: null,
        },
      ],
      theoreticalCost: { total: '0', complete: false },
      version: 9,
    },
  ],
};

const api = (overrides: Record<string, (init: RequestInit) => Response> = {}) => ({
  'GET /modifier-groups': () => jsonResponse(200, [SAUCE]),
  [`GET /modifier-options/${SAUCE.options[1].id}/recipe`]: () => jsonResponse(200, NO_SAUCE_RECIPE),
  'GET /units': () =>
    jsonResponse(200, [{ code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 }]),
  ...overrides,
});

describe('modifier groups (#16)', () => {
  it('lists groups with their options and price changes, and shows an option’s recipe', async () => {
    mockApi(api());
    renderApp('/modifiers', { as: MENU_READER });
    const u = userEvent.setup();

    const row = (await screen.findByRole('rowheader', { name: /น้ำจิ้ม/ })).closest('tr')!;
    expect(within(row).getByText('0–1 ตัว')).toBeVisible();
    expect(row).toHaveTextContent('เพิ่มน้ำจิ้มเผ็ด SAUCE-HOT (+10 บาท)');
    expect(within(row).queryByRole('button', { name: /แก้ไขกลุ่ม/ })).toBeNull();
    expect(await axeViolations()).toEqual([]);

    await u.click(within(row).getByRole('button', { name: 'ดูสูตรของ ไม่รับน้ำจิ้ม' }));
    expect(await screen.findByText('-1 ชิ้น')).toBeVisible();
    // No ingredient has a lot to cost it: no figure rather than a cost of zero.
    expect(
      screen.getByText('ยังคิดต้นทุนตามทฤษฎีไม่ได้ ไม่มีวัตถุดิบไหนมี lot ให้คิดต้นทุน'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'ปริมาณต่อหนึ่งหน่วยที่ขายในบรรทัด เพิ่ม (มากกว่าศูนย์) หรือหัก (ติดลบ) จากสูตรเมนู',
      ),
    ).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('deactivates an option rather than removing it, and keeps saved codes fixed', async () => {
    const fetchMock = mockApi(
      api({
        [`PATCH /modifier-groups/${SAUCE.id}`]: () =>
          jsonResponse(200, {
            ...SAUCE,
            version: 8,
            options: [SAUCE.options[0], { ...SAUCE.options[1], active: false }],
          }),
      }),
    );
    renderApp('/modifiers', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'แก้ไขกลุ่ม น้ำจิ้ม' }));
    const form = screen.getByRole('form', { name: 'แก้ไข SAUCE' });
    expect(within(form).getByLabelText('รหัสตัวเลือก (ตัวที่ 1)')).toHaveAttribute('readonly');
    expect(within(form).queryByRole('button', { name: 'เอาตัวเลือกที่ 2 ออก' })).toBeNull();
    await u.click(within(form).getByLabelText('ใช้งาน (ตัวที่ 2)'));
    expect(await axeViolations()).toEqual([]);
    await u.click(within(form).getByRole('button', { name: 'บันทึก' }));

    expect(await screen.findByText('บันทึก SAUCE แล้ว')).toBeVisible();
    const patch = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'PATCH');
    expect(sentBody(fetchMock, patch)).toEqual({
      nameTh: 'น้ำจิ้ม',
      nameEn: 'Sauce',
      minSelections: 0,
      maxSelections: 1,
      active: true,
      version: 7,
      options: [
        {
          code: 'SAUCE-HOT',
          nameTh: 'เพิ่มน้ำจิ้มเผ็ด',
          nameEn: 'Extra hot sauce',
          priceChange: '10',
          active: true,
        },
        {
          code: 'NO-SAUCE',
          nameTh: 'ไม่รับน้ำจิ้ม',
          nameEn: 'No sauce',
          priceChange: '0',
          active: false,
        },
      ],
    });
  });

  it('explains an option code another group already uses', async () => {
    mockApi(
      api({
        'POST /modifier-groups': () =>
          jsonResponse(409, {
            statusCode: 409,
            code: 'MODIFIER_CODE_TAKEN',
            message: 'taken',
            details: { codes: ['SAUCE-HOT'] },
          }),
      }),
    );
    renderApp('/modifiers', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เพิ่มกลุ่มตัวเลือก' }));
    const form = screen.getByRole('form', { name: 'กลุ่มตัวเลือกใหม่' });
    await u.type(within(form).getByLabelText('รหัสกลุ่ม'), 'extra');
    await u.type(within(form).getByLabelText('ชื่อภาษาไทย'), 'ซอสเพิ่ม');
    await u.type(within(form).getByLabelText('ชื่อภาษาอังกฤษ'), 'Extra sauce');
    await u.type(within(form).getByLabelText('รหัสตัวเลือก (ตัวที่ 1)'), 'sauce-hot');
    await u.type(within(form).getByLabelText('ชื่อภาษาไทย (ตัวที่ 1)'), 'เผ็ด');
    await u.type(within(form).getByLabelText('ชื่อภาษาอังกฤษ (ตัวที่ 1)'), 'Hot');
    await u.click(within(form).getByRole('button', { name: 'สร้างกลุ่ม' }));

    expect(
      await within(form).findByText('มีตัวเลือกในกลุ่มอื่นที่ใช้รหัสนี้แล้ว รหัสตัวเลือกห้ามซ้ำ'),
    ).toBeVisible();
  });
});

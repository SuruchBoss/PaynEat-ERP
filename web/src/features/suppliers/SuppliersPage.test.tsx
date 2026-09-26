// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import {
  axeViolations,
  jsonResponse,
  mockApi,
  PURCHASING,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import { formatTaxId, type SupplierView } from './suppliers.api';

const supplier = (overrides: Partial<SupplierView>): SupplierView => ({
  id: '00000000-0000-4000-8000-000000000000',
  code: 'SUP',
  name: 'Supplier',
  taxId: '0000000000001',
  contactName: null,
  phone: null,
  email: null,
  address: null,
  active: true,
  revision: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  ...overrides,
});

const CHICKEN = supplier({
  id: '00000000-0000-4000-8000-00000000000a',
  code: 'SUP-CHICKEN',
  name: 'บริษัท ฟาร์มไก่เดโม จำกัด (สมมติ)',
  contactName: 'ฝ่ายขาย',
  phone: '02-000-0001',
  email: 'sales@chicken-farm.example',
  revision: 2,
});
const DRY = supplier({
  id: '00000000-0000-4000-8000-00000000000b',
  code: 'SUP-DRYGOODS',
  name: 'บริษัท วัตถุดิบเดโม จำกัด (สมมติ)',
  taxId: '0000000000027',
});

const rowOf = (name: string) => {
  const row = screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
};

describe('suppliers', () => {
  it('formats a tax id the way it is printed', () => {
    expect(formatTaxId('0105512345678')).toBe('0-1055-12345-67-8');
    expect(formatTaxId('123')).toBe('123');
  });

  it('lists suppliers for anyone signed in, and passes axe in both languages', async () => {
    mockApi({ 'GET /suppliers': () => jsonResponse(200, [CHICKEN, DRY]) });
    const view = renderApp('/suppliers', { as: STAFF });

    expect(await screen.findByRole('heading', { level: 1, name: 'ซัพพลายเออร์' })).toBeVisible();
    await screen.findByText(CHICKEN.name);
    expect(rowOf('ฟาร์มไก่').getByText('0-0000-00000-00-1')).toBeVisible();
    expect(rowOf('ฟาร์มไก่').getByText('02-000-0001')).toBeVisible();
    expect(rowOf('วัตถุดิบ').getByText('ไม่ได้ระบุ')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'เพิ่มซัพพลายเออร์' })).not.toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/suppliers', { as: STAFF });
    await screen.findByText(CHICKEN.name);
    expect(screen.getByRole('columnheader', { name: 'Tax ID' })).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('lets purchasing create a supplier, sending the tax id as typed', async () => {
    let created: SupplierView | null = null;
    const api = mockApi({
      'GET /suppliers': () => jsonResponse(200, created ? [CHICKEN, created] : [CHICKEN]),
      'POST /suppliers': (init) => {
        const body = JSON.parse(String(init.body)) as SupplierView;
        created = supplier({
          ...body,
          id: '00000000-0000-4000-8000-00000000000c',
          taxId: '0000000000001',
        });
        return jsonResponse(201, created);
      },
    });
    renderApp('/suppliers', { as: PURCHASING });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เพิ่มซัพพลายเออร์' }));
    const form = screen.getByRole('form', { name: 'ซัพพลายเออร์ใหม่' });
    await u.type(within(form).getByLabelText('รหัสซัพพลายเออร์'), 'sup-oil');
    await u.type(within(form).getByLabelText('ชื่อบริษัท'), 'บริษัท น้ำมันเดโม จำกัด (สมมติ)');
    await u.type(
      within(form).getByLabelText('เลขประจำตัวผู้เสียภาษี 13 หลัก'),
      '0-0000-00000-00-1',
    );
    await u.type(within(form).getByLabelText('อีเมล'), 'sales@oil.example');
    expect(await axeViolations()).toEqual([]);
    await u.click(within(form).getByRole('button', { name: 'สร้างซัพพลายเออร์' }));

    expect(await screen.findByText('สร้างซัพพลายเออร์ SUP-OIL แล้ว')).toBeVisible();
    const post = api.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(api, post)).toEqual({
      code: 'SUP-OIL',
      name: 'บริษัท น้ำมันเดโม จำกัด (สมมติ)',
      taxId: '0-0000-00000-00-1',
      contactName: '',
      phone: '',
      email: 'sales@oil.example',
      address: '',
    });
  });

  it('explains a tax id that fails its check digit', async () => {
    mockApi({
      'GET /suppliers': () => jsonResponse(200, [CHICKEN]),
      'POST /suppliers': () =>
        jsonResponse(422, {
          code: 'INVALID_TAX_ID',
          message: 'x',
          details: { problem: 'CHECK_DIGIT' },
        }),
    });
    renderApp('/suppliers', { as: PURCHASING });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'เพิ่มซัพพลายเออร์' }));
    const form = screen.getByRole('form', { name: 'ซัพพลายเออร์ใหม่' });
    await u.type(within(form).getByLabelText('รหัสซัพพลายเออร์'), 'SUP-X');
    await u.type(within(form).getByLabelText('ชื่อบริษัท'), 'x');
    await u.type(within(form).getByLabelText('เลขประจำตัวผู้เสียภาษี 13 หลัก'), '0000000000002');
    await u.click(within(form).getByRole('button', { name: 'สร้างซัพพลายเออร์' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง');
  });

  it('edits and deactivates a supplier from the revision it was opened at', async () => {
    let current = CHICKEN;
    const api = mockApi({
      'GET /suppliers': () => jsonResponse(200, [current]),
      [`PATCH /suppliers/${CHICKEN.id}`]: (init) => {
        const body = JSON.parse(String(init.body)) as Partial<SupplierView>;
        current = { ...current, ...body, revision: current.revision + 1 };
        return jsonResponse(200, current);
      },
    });
    renderApp('/suppliers', { as: PURCHASING });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: `แก้ไข ${CHICKEN.name}` }));
    const form = screen.getByRole('form', { name: 'แก้ไขซัพพลายเออร์ SUP-CHICKEN' });
    expect(within(form).queryByLabelText('รหัสซัพพลายเออร์')).not.toBeInTheDocument();
    expect(within(form).getByLabelText('เลขประจำตัวผู้เสียภาษี 13 หลัก')).toHaveValue(
      '0-0000-00000-00-1',
    );
    await u.clear(within(form).getByLabelText('โทรศัพท์'));
    await u.click(within(form).getByRole('button', { name: 'บันทึกการแก้ไข' }));
    expect(await screen.findByText('บันทึกซัพพลายเออร์ SUP-CHICKEN แล้ว')).toBeVisible();
    const patch = api.mock.calls.findIndex(([, init]) => init?.method === 'PATCH');
    expect(sentBody(api, patch)).toMatchObject({ revision: 2, phone: '' });

    await u.click(screen.getByRole('button', { name: `แก้ไข ${CHICKEN.name}` }));
    await u.click(screen.getByRole('button', { name: 'ปิดใช้งานซัพพลายเออร์นี้' }));
    expect(await screen.findByText('ปิดใช้งาน SUP-CHICKEN แล้ว')).toBeVisible();
    expect(
      sentBody(
        api,
        api.mock.calls.findLastIndex(([, init]) => init?.method === 'PATCH'),
      ),
    ).toEqual({
      revision: 3,
      active: false,
    });
  });
});

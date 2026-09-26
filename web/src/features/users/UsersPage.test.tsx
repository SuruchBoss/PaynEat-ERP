// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import {
  ADMIN,
  axeViolations,
  jsonResponse,
  mockApi,
  renderApp,
  sentBody,
  STAFF,
} from '@/test/render';
import type { UserView } from './users.api';

const user = (overrides: Partial<UserView>): UserView => ({
  id: '00000000-0000-4000-8000-000000000000',
  email: 'someone@demo-chicken.example',
  displayName: 'Someone',
  locale: 'th',
  status: 'ACTIVE',
  roles: [],
  mfaEnabled: false,
  mfaRequired: false,
  lastLoginAt: null,
  createdAt: '2026-09-26T00:00:00.000Z',
  ...overrides,
});

const ADMIN_ROW = user({
  id: '00000000-0000-4000-8000-00000000000a',
  email: 'admin@demo-chicken.example',
  displayName: 'Demo admin',
  roles: ['admin'],
  mfaEnabled: true,
  mfaRequired: true,
  lastLoginAt: '2026-09-26T01:02:03.000Z',
});
const PLANT_ROW = user({
  id: '00000000-0000-4000-8000-00000000000b',
  email: 'plant@demo-chicken.example',
  displayName: 'Demo plant',
  roles: ['plant', 'logistics'],
});

const rowOf = (name: string) => {
  const row = screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
};

describe('users and roles', () => {
  it('lists every user with their roles, second factor and last sign-in, and passes axe in both languages', async () => {
    mockApi({ 'GET /users': () => jsonResponse(200, [ADMIN_ROW, PLANT_ROW]) });
    const view = renderApp('/users', { as: ADMIN });

    expect(await screen.findByRole('heading', { level: 1, name: 'ผู้ใช้และบทบาท' })).toBeVisible();
    await screen.findByText('Demo plant');
    expect(rowOf('Demo admin').getByText('ผู้ดูแลระบบ')).toBeVisible();
    expect(rowOf('Demo admin').getByText('เปิดแล้ว')).toBeVisible();
    expect(rowOf('Demo plant').getByText('โรงงาน')).toBeVisible();
    expect(rowOf('Demo plant').getByText('ขนส่ง')).toBeVisible();
    expect(rowOf('Demo plant').getByText('ไม่ได้ใช้')).toBeVisible();
    expect(rowOf('Demo plant').getByText('ยังไม่เคย')).toBeVisible();
    expect(await axeViolations()).toEqual([]);

    view.unmount();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderApp('/users', { as: ADMIN });
    await screen.findByText('Demo plant');
    expect(rowOf('Demo plant').getByText('Logistics')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Manage roles of Demo plant' })).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('marks a disabled account on its row, in both languages', async () => {
    const disabled = user({
      id: '00000000-0000-4000-8000-00000000000c',
      email: 'old.staff@demo-chicken.example',
      displayName: 'Former staff',
      roles: ['plant'],
      status: 'DISABLED',
    });
    mockApi({ 'GET /users': () => jsonResponse(200, [ADMIN_ROW, disabled]) });
    renderApp('/users', { as: ADMIN });

    await screen.findByText('Former staff');
    expect(rowOf('Former staff').getByText('ปิดใช้งาน')).toBeVisible();
    expect(rowOf('Demo admin').queryByText('ปิดใช้งาน')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'English' }));
    expect(rowOf('Former staff').getByText('Disabled')).toBeVisible();
  });

  it('creates a user with roles, then shows them in the list', async () => {
    let created: UserView | null = null;
    const api = mockApi({
      'GET /users': () => jsonResponse(200, created ? [ADMIN_ROW, created] : [ADMIN_ROW]),
      'POST /users': (init) => {
        const body = JSON.parse(String(init.body)) as UserView & { password: string };
        created = user({
          id: '00000000-0000-4000-8000-00000000000c',
          email: body.email,
          displayName: body.displayName,
          roles: body.roles,
        });
        return jsonResponse(201, created);
      },
    });
    renderApp('/users', { as: ADMIN });
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'เพิ่มผู้ใช้' }));
    const form = screen.getByRole('form', { name: 'เพิ่มผู้ใช้ใหม่' });
    expect(within(form).getByRole('heading', { name: 'เพิ่มผู้ใช้ใหม่' })).toHaveFocus();
    expect(await axeViolations()).toEqual([]);

    await u.type(within(form).getByLabelText('ชื่อที่แสดง'), 'สมศรี คลังดี');
    await u.type(within(form).getByLabelText('อีเมล'), 'somsri@demo-chicken.example');
    await u.type(within(form).getByLabelText('รหัสผ่านเริ่มต้น'), 'crispy wings every friday');
    await u.selectOptions(within(form).getByLabelText('ภาษาของผู้ใช้'), 'en');
    await u.click(within(form).getByRole('checkbox', { name: /ผู้จัดการสาขา/ }));
    await u.click(within(form).getByRole('checkbox', { name: /การเงิน/ }));
    await u.click(within(form).getByRole('button', { name: 'สร้างผู้ใช้' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'สร้างผู้ใช้ somsri@demo-chicken.example แล้ว',
    );
    const post = api.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(sentBody(api, post)).toEqual({
      email: 'somsri@demo-chicken.example',
      displayName: 'สมศรี คลังดี',
      password: 'crispy wings every friday',
      locale: 'en',
      roles: ['branch_manager', 'finance'],
    });
    expect(await screen.findByText('สมศรี คลังดี')).toBeVisible();
    expect(screen.queryByRole('form', { name: 'เพิ่มผู้ใช้ใหม่' })).not.toBeInTheDocument();

    // The notice follows a switch of language made after it appeared.
    await u.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Created somsri@demo-chicken.example. Give the first password to its owner in person.',
    );
  });

  it.each([
    ['EMAIL_TAKEN', 409, 'มีผู้ใช้ที่ใช้อีเมลนี้อยู่แล้ว'],
    ['WEAK_PASSWORD', 422, 'รหัสผ่านไม่ผ่านเกณฑ์'],
  ])('explains %s when a user cannot be created', async (code, status, message) => {
    mockApi({
      'GET /users': () => jsonResponse(200, [ADMIN_ROW]),
      'POST /users': () => jsonResponse(status, { code, message: 'x', requestId: 'erp-web-1' }),
    });
    renderApp('/users', { as: ADMIN });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'เพิ่มผู้ใช้' }));
    const form = screen.getByRole('form', { name: 'เพิ่มผู้ใช้ใหม่' });
    await u.type(within(form).getByLabelText('ชื่อที่แสดง'), 'X');
    await u.type(within(form).getByLabelText('อีเมล'), 'x@demo-chicken.example');
    await u.type(within(form).getByLabelText('รหัสผ่านเริ่มต้น'), 'password1234');
    await u.click(within(form).getByRole('button', { name: 'สร้างผู้ใช้' }));

    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent('erp-web-1');
  });

  it('gives and takes away roles one tick at a time', async () => {
    let current = PLANT_ROW;
    const api = mockApi({
      'GET /users': () => jsonResponse(200, [ADMIN_ROW, current]),
      [`PUT /users/${PLANT_ROW.id}/roles/finance`]: () => {
        current = { ...current, roles: [...current.roles, 'finance'] };
        return jsonResponse(200, current);
      },
      [`DELETE /users/${PLANT_ROW.id}/roles/plant`]: () => {
        current = { ...current, roles: current.roles.filter((r) => r !== 'plant') };
        return jsonResponse(200, current);
      },
    });
    renderApp('/users', { as: ADMIN });
    const u = userEvent.setup();

    const open = await screen.findByRole('button', { name: 'จัดการบทบาทของ Demo plant' });
    await u.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    const editor = screen.getByRole('region', { name: 'บทบาทของ Demo plant' });
    expect(within(editor).getByRole('checkbox', { name: /โรงงาน/ })).toBeChecked();
    expect(within(editor).getByRole('checkbox', { name: /การเงิน/ })).not.toBeChecked();
    expect(await axeViolations()).toEqual([]);

    await u.click(within(editor).getByRole('checkbox', { name: /การเงิน/ }));
    expect(await within(editor).findByRole('checkbox', { name: /การเงิน/ })).toBeChecked();
    expect(within(editor).getByRole('status')).toHaveTextContent(
      'ให้บทบาท “การเงิน” แก่ Demo plant แล้ว',
    );

    await u.click(within(editor).getByRole('checkbox', { name: /โรงงาน/ }));
    await within(editor).findByText('ถอนบทบาท “โรงงาน” จาก Demo plant แล้ว', {
      selector: '[role=status]',
    });
    expect(within(editor).getByRole('checkbox', { name: /โรงงาน/ })).not.toBeChecked();
    expect(rowOf('Demo plant').getByText('การเงิน')).toBeVisible();
    expect(rowOf('Demo plant').queryByText('โรงงาน')).not.toBeInTheDocument();

    const methods = api.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`);
    expect(methods).toContain(`PUT /api/v1/users/${PLANT_ROW.id}/roles/finance`);
    expect(methods).toContain(`DELETE /api/v1/users/${PLANT_ROW.id}/roles/plant`);
  });

  it('explains why the last administrator keeps the role', async () => {
    mockApi({
      'GET /users': () => jsonResponse(200, [ADMIN_ROW]),
      [`DELETE /users/${ADMIN_ROW.id}/roles/admin`]: () =>
        jsonResponse(409, { code: 'LAST_ADMIN', message: 'x' }),
    });
    renderApp('/users', { as: ADMIN });
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'จัดการบทบาทของ Demo admin' }));
    const editor = screen.getByRole('region', { name: 'บทบาทของ Demo admin' });
    await u.click(within(editor).getByRole('checkbox', { name: /ผู้ดูแลระบบ/ }));

    expect(await within(editor).findByRole('alert')).toHaveTextContent('ผู้ดูแลระบบคนสุดท้าย');
    expect(within(editor).getByRole('checkbox', { name: /ผู้ดูแลระบบ/ })).toBeChecked();
  });

  it('is neither in the menu nor open to someone whose roles do not allow it', async () => {
    mockApi({
      'GET /health': () => jsonResponse(200, { status: 'ok', api: 'up', database: 'up' }),
    });
    const first = renderApp('/', { as: STAFF });
    await screen.findByRole('heading', { level: 1, name: 'สถานะระบบ' });
    expect(screen.queryByRole('link', { name: 'ผู้ใช้และบทบาท' })).not.toBeInTheDocument();
    first.unmount();

    renderApp('/users', { as: STAFF });
    expect(
      screen.getByRole('heading', { level: 1, name: 'คุณไม่มีสิทธิ์เปิดหน้านี้' }),
    ).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('shows administrators the menu entry', async () => {
    mockApi({
      'GET /health': () => jsonResponse(200, { status: 'ok', api: 'up', database: 'up' }),
    });
    renderApp('/', { as: ADMIN });
    const nav = await screen.findByRole('navigation', { name: 'เมนูหลัก' });
    expect(within(nav).getByRole('link', { name: 'ผู้ใช้และบทบาท' })).toHaveAttribute(
      'href',
      '/users',
    );
    expect(within(nav).getByText('Demo admin')).toBeVisible();
  });
});

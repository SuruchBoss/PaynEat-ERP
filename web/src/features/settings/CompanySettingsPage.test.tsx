// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADMIN,
  axeViolations,
  jsonResponse,
  mockApi,
  PURCHASING,
  renderApp,
  sentBody,
} from '@/test/render';

describe('company settings', () => {
  it('lets the admin set the threshold and the sale-time tolerance, sent with the revision it was opened at', async () => {
    let settings = {
      purchaseApprovalThreshold: '0.00',
      saleTimeAheadToleranceMinutes: 10,
      revision: 0,
      updated: null as unknown,
    };
    const api = mockApi({
      'GET /company/settings': () => jsonResponse(200, settings),
      'PATCH /company/settings': () => {
        settings = {
          purchaseApprovalThreshold: '20000.00',
          saleTimeAheadToleranceMinutes: 15,
          revision: 1,
          updated: {
            by: { id: ADMIN.id, displayName: 'Demo admin' },
            at: '2026-10-05T03:00:00.000Z',
          },
        };
        return jsonResponse(200, settings);
      },
    });
    renderApp('/settings', { as: ADMIN });
    const u = userEvent.setup();

    expect(await screen.findByRole('heading', { level: 1, name: 'ตั้งค่าบริษัท' })).toBeVisible();
    expect(
      await screen.findByText('ยังไม่เคยตั้งค่า ใช้ค่าเริ่มต้น 0 (ทุกใบต้องอนุมัติ)'),
    ).toBeVisible();
    const field = screen.getByLabelText('เกณฑ์วงเงิน (บาท)');
    expect(field).toHaveValue('0.00');
    expect(await axeViolations()).toEqual([]);

    const tolerance = screen.getByLabelText('จำนวนนาที (0 ถึง 1440)');
    expect(tolerance).toHaveValue('10');

    await u.clear(field);
    await u.type(field, '20000');
    await u.clear(tolerance);
    await u.type(tolerance, '15');
    await u.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('ตั้งเกณฑ์วงเงินเป็น 20,000.00 บาทแล้ว')).toBeVisible();
    expect(await screen.findByText(/แก้ไขล่าสุด .* โดย Demo admin/)).toBeVisible();
    const call = api.mock.calls.findIndex(([, init]) => init?.method === 'PATCH');
    expect(sentBody(api, call)).toEqual({
      revision: 0,
      purchaseApprovalThreshold: '20000',
      saleTimeAheadToleranceMinutes: 15,
    });
  });

  it('says why a threshold is refused', async () => {
    mockApi({
      'GET /company/settings': () =>
        jsonResponse(200, {
          purchaseApprovalThreshold: '20000.00',
          saleTimeAheadToleranceMinutes: 10,
          revision: 1,
          updated: null,
        }),
      'PATCH /company/settings': () =>
        jsonResponse(422, { code: 'INVALID_APPROVAL_THRESHOLD', message: 'x' }),
    });
    renderApp('/settings', { as: ADMIN });
    const u = userEvent.setup();

    const field = await screen.findByLabelText('เกณฑ์วงเงิน (บาท)');
    await u.clear(field);
    await u.type(field, '-1');
    await u.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(
      await screen.findByText(
        'เกณฑ์วงเงินต้องเป็นจำนวนเงินตั้งแต่ 0 ขึ้นไป ทศนิยมไม่เกิน 2 ตำแหน่ง',
      ),
    ).toBeVisible();
  });

  it('is only the admin’s: others do not see it in the navigation', async () => {
    mockApi({
      'GET /company/settings': () =>
        jsonResponse(200, {
          purchaseApprovalThreshold: '20000.00',
          saleTimeAheadToleranceMinutes: 10,
          revision: 1,
          updated: null,
        }),
      'GET /purchase-orders': () => jsonResponse(200, []),
    });
    renderApp('/purchase-orders', { as: PURCHASING });
    expect(await screen.findByRole('heading', { level: 1, name: 'ใบสั่งซื้อ' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'ตั้งค่าบริษัท' })).toBeNull();
  });
});

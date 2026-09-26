// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axeViolations, jsonResponse, mockApi, renderApp } from '@/test/render';

const healthy = {
  'GET /health': () => jsonResponse(200, { status: 'ok', api: 'up', database: 'up' }),
};

describe('demo installation banner (#5)', () => {
  it('shows on the sign-in screen of a demo installation, in both languages', async () => {
    mockApi(healthy, { installation: { demo: true } });
    renderApp('/sign-in', { as: null });

    const banner = await screen.findByRole('complementary', { name: 'ระบบเดโม' });
    expect(banner).toHaveTextContent('บัญชีเดโมใช้รหัสผ่านที่เปิดเผยต่อสาธารณะ');
    expect(await axeViolations()).toEqual([]);

    await userEvent.setup().click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('complementary', { name: 'Demo installation.' })).toHaveTextContent(
      'The demo accounts use published passwords.',
    );
  });

  it('stays on every screen once signed in, with no way to dismiss it', async () => {
    mockApi(healthy, { installation: { demo: true } });
    renderApp('/');

    const banner = await screen.findByRole('complementary', { name: 'ระบบเดโม' });
    expect(banner.querySelector('button')).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it('is absent from an installation that is not a demo', async () => {
    mockApi(healthy);
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'สถานะระบบ' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});

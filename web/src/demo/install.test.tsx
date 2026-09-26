// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listUsers } from '@/features/users/users.api';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ApiError } from '@/lib/api-error';
import { useAuthStore } from '@/stores/auth.store';
import { axeViolations, renderApp } from '@/test/render';
import DemoSignInHelp from './DemoSignInHelp';
import { installDemoApi } from './install';
import { DEMO_PASSWORD, DEMO_RECOVERY_CODES } from './seed';
import { DemoServer } from './server';

const realFetch = window.fetch;

afterEach(() => {
  window.fetch = realFetch;
  document.documentElement.removeAttribute('data-demo-api');
});

describe('the demo API in front of fetch (#41)', () => {
  it('answers the API paths of its own origin and lets everything else through', async () => {
    const elsewhere = vi.fn(async () => new Response('elsewhere'));
    const target = {
      fetch: elsewhere,
      location: new URL('https://suruchboss.github.io/PaynEat-ERP/items'),
      document,
    } as unknown as Window;
    installDemoApi(target, new DemoServer(), 0);

    const answer = await target.fetch('/api/v1/installation', {
      headers: { 'x-request-id': 'erp-web-00000000aaaaaaaa' },
    });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-request-id')).toBe('erp-web-00000000aaaaaaaa');
    expect(await answer.json()).toEqual({ demo: true });

    await target.fetch('/PaynEat-ERP/favicon.svg');
    await target.fetch('https://example.com/api/v1/installation');
    expect(elsewhere).toHaveBeenCalledTimes(2);
    expect(document.documentElement).toHaveAttribute('data-demo-api');
  });

  it('serves the console’s own client: the admin signs in with a recovery code', async () => {
    installDemoApi(window, new DemoServer(), 0);
    const { login, verifyMfa } = useAuthStore.getState();

    const challenge = await login('admin@demo-chicken.example', DEMO_PASSWORD);
    expect(challenge).toMatchObject({ mfaRequired: true, mfaEnrolled: true });
    await verifyMfa(challenge!.challengeToken, DEMO_RECOVERY_CODES[1]);

    const users = await listUsers();
    expect(users).toHaveLength(7);
    expect(users.map((u) => u.email)).toContain('plant@demo-chicken.example');
  });

  it('runs the real console: the plant signs in and finds the seed stock', async () => {
    installDemoApi(window, new DemoServer(), 0);
    renderApp('/stock', { as: null });

    expect(await screen.findByRole('complementary', { name: 'ระบบเดโม' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('อีเมล'), 'plant@demo-chicken.example');
    await user.type(screen.getByLabelText('รหัสผ่าน'), DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'สต๊อกคงเหลือ' }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText(/^OB-\d{4}-00001\/1$/)).length).toBeGreaterThan(0);
  });
});

describe('the demo sign-in help (#41)', () => {
  it('lists the demo accounts and fills the form with the one picked', async () => {
    const onPick = vi.fn();
    render(
      <I18nProvider>
        <DemoSignInHelp step="password" onPick={onPick} />
      </I18nProvider>,
    );
    expect(screen.getByRole('complementary', { name: 'บัญชีเดโม' })).toHaveTextContent(
      DEMO_PASSWORD,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'โรงงาน' }));
    expect(onPick).toHaveBeenCalledWith('plant@demo-chicken.example', DEMO_PASSWORD);
    expect(await axeViolations()).toEqual([]);
  });

  it('shows the administrator’s recovery codes at the code step', async () => {
    render(
      <I18nProvider>
        <DemoSignInHelp step="code" onPick={vi.fn()} />
      </I18nProvider>,
    );
    const codes = screen.getByRole('list', { name: 'รหัสกู้คืนของผู้ดูแลระบบเดโม' });
    expect(codes).toHaveTextContent(DEMO_RECOVERY_CODES[0]);
    expect(await axeViolations()).toEqual([]);
  });
});

describe('a screen the demo does not serve (#41)', () => {
  it('says so, rather than failing some other way', () => {
    render(
      <I18nProvider>
        <ErrorCallout error={new ApiError(404, 'NOT_IN_DEMO', '')} />
      </I18nProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('ส่วนนี้ยังไม่มีในเดโม');
  });
});

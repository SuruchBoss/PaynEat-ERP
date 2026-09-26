import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import { SESSION_STORAGE_KEY, useAuthStore } from '@/stores/auth.store';
import {
  ADMIN,
  axeViolations,
  jsonResponse,
  mockApi,
  renderApp,
  sentBody,
  sentHeaders,
  STAFF,
} from '@/test/render';

const session = (user = STAFF) => ({
  mfaRequired: false,
  accessToken: 'access-after-sign-in',
  refreshToken: 'refresh-after-sign-in',
  expiresIn: 900,
  tokenType: 'Bearer',
  user,
});

const healthy = () => jsonResponse(200, { status: 'ok', api: 'up', database: 'up' });

async function typeCredentials(email = 'finance@demo-chicken.example', password = 'secret-pass') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('อีเมล'), email);
  await user.type(screen.getByLabelText('รหัสผ่าน'), password);
  await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
  return user;
}

describe('sign-in', () => {
  it('is where a signed-out person lands, whatever they opened, and passes axe in both languages', async () => {
    renderApp('/users', { as: null });
    expect(await screen.findByRole('heading', { level: 1, name: 'เข้าสู่ระบบ' })).toBeVisible();
    expect(screen.getByLabelText('อีเมล')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveAttribute('type', 'password');
    expect(await axeViolations()).toEqual([]);

    await userEvent.setup().click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('signs in with a password alone when the account has no second factor', async () => {
    const api = mockApi({
      'POST /auth/login': () => jsonResponse(200, session()),
      'GET /health': healthy,
    });
    renderApp('/', { as: null });

    await typeCredentials('  finance@demo-chicken.example ');

    expect(await screen.findByRole('heading', { level: 1, name: 'สถานะระบบ' })).toBeVisible();
    expect(sentBody(api, 0)).toEqual({
      email: 'finance@demo-chicken.example',
      password: 'secret-pass',
    });
    // The sign-in request itself carries no credentials of a previous session.
    expect(sentHeaders(api, 0).get('authorization')).toBeNull();
    expect(sentHeaders(api, 1).get('authorization')).toBe('Bearer access-after-sign-in');
    expect(screen.getByText('Demo finance')).toBeVisible();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toContain('refresh-after-sign-in');
  });

  it('says so when the email or password is wrong, without a correlation id to quote', async () => {
    mockApi({
      'POST /auth/login': () =>
        jsonResponse(401, {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          requestId: 'erp-web-0000000000000001',
        }),
    });
    renderApp('/', { as: null });
    await typeCredentials();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    expect(alert).not.toHaveTextContent('erp-web-0000000000000001');
    expect(screen.getByLabelText('รหัสผ่าน')).toHaveValue('');
  });

  it('explains a locked account', async () => {
    mockApi({
      'POST /auth/login': () =>
        jsonResponse(422, { code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts.' }),
    });
    renderApp('/', { as: null });
    await typeCredentials();
    expect(await screen.findByRole('alert')).toHaveTextContent('บัญชีถูกล็อกชั่วคราว');
  });

  it('shows the correlation id when something unexpected fails', async () => {
    mockApi({
      'POST /auth/login': () =>
        jsonResponse(500, { code: 'INTERNAL_ERROR', requestId: 'erp-web-00000000000000ff' }),
    });
    renderApp('/', { as: null });
    await typeCredentials();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('เกิดข้อผิดพลาดที่ไม่คาดคิด');
    expect(alert).toHaveTextContent('erp-web-00000000000000ff');
  });

  describe('with a second factor', () => {
    const challenge = {
      mfaRequired: true,
      mfaEnrolled: true,
      challengeToken: 'ch-1',
      expiresIn: 300,
    };

    it('asks for the code, refuses a wrong one, then opens the page first asked for', async () => {
      let attempts = 0;
      const api = mockApi({
        'POST /auth/login': () => jsonResponse(200, challenge),
        'POST /auth/mfa/verify': () =>
          ++attempts === 1
            ? jsonResponse(401, { code: 'SECOND_FACTOR_REJECTED', message: 'no' })
            : jsonResponse(200, session(ADMIN)),
        'GET /users': () => jsonResponse(200, []),
      });
      renderApp('/users', { as: null });
      const user = await typeCredentials('admin@demo-chicken.example');

      const heading = await screen.findByRole('heading', {
        level: 1,
        name: 'ยืนยันตัวตนขั้นที่สอง',
      });
      await waitFor(() => expect(heading).toHaveFocus());
      expect(useAuthStore.getState().accessToken).toBeNull(); // a challenge is not a session
      expect(await axeViolations()).toEqual([]);

      const code = screen.getByLabelText('รหัสยืนยัน');
      expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      await user.type(code, '000000');
      await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('รหัสไม่ถูกต้อง');

      await user.clear(code);
      await user.type(code, '123456');
      await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'ผู้ใช้และบทบาท' }),
      ).toBeVisible();
      expect(sentBody(api, 2)).toEqual({ challengeToken: 'ch-1', code: '123456' });
    });

    it('can start over from the code step', async () => {
      mockApi({ 'POST /auth/login': () => jsonResponse(200, challenge) });
      renderApp('/', { as: null });
      const user = await typeCredentials('admin@demo-chicken.example');
      await user.click(await screen.findByRole('button', { name: 'เริ่มใหม่' }));
      expect(screen.getByRole('heading', { level: 1, name: 'เข้าสู่ระบบ' })).toBeVisible();
    });

    it('sets one up first for an admin who has none, and shows the recovery codes once', async () => {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
      const recoveryCodes = ['AAAAA-BBBBB-CCCCC-DDDDD', 'EEEEE-FFFFF-GGGGG-HHHHH'];
      const api = mockApi({
        'POST /auth/login': () =>
          jsonResponse(200, { ...challenge, mfaEnrolled: false, challengeToken: 'ch-2' }),
        'POST /auth/mfa/enroll': () =>
          jsonResponse(200, {
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUri:
              'otpauth://totp/PaynEat%20ERP%3Anew%40demo-chicken.example?secret=JBSWY3DPEHPK3PXP',
          }),
        'POST /auth/mfa/activate': () =>
          jsonResponse(200, {
            recoveryCodes,
            session: session({ ...ADMIN, displayName: 'New admin' }),
          }),
        'GET /health': healthy,
      });
      renderApp('/', { as: null });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Email'), 'new@demo-chicken.example');
      await user.type(screen.getByLabelText('Password'), 'a long first password');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Set up two-factor authentication' }),
      ).toBeVisible();
      const qr = screen.getByRole('img', {
        name: 'QR code that adds this account to an authenticator app',
      });
      expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
      expect(sentBody(api, 1)).toEqual({ challengeToken: 'ch-2' });
      expect(await axeViolations()).toEqual([]);

      await user.type(screen.getByLabelText('Verification code'), '654321');
      await user.click(screen.getByRole('button', { name: 'Turn on and sign in' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Keep your recovery codes' }),
      ).toBeVisible();
      for (const code of recoveryCodes) expect(screen.getByText(code)).toBeVisible();
      expect(sentBody(api, 2)).toEqual({ challengeToken: 'ch-2', code: '654321' });
      // Not signed in until the person has seen the codes.
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(await axeViolations()).toEqual([]);

      await user.click(screen.getByRole('button', { name: 'I have saved them — continue' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
      expect(screen.getByText('New admin')).toBeVisible();
    });
  });
});

describe('a session', () => {
  it('signs out: the API is told, the session is forgotten, the sign-in page returns', async () => {
    const api = mockApi({
      'GET /health': healthy,
      'POST /auth/logout': () => new Response(null, { status: 204 }),
    });
    renderApp('/');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'ออกจากระบบ' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'เข้าสู่ระบบ' })).toBeVisible();
    const logout = api.mock.calls.findIndex(([url]) => String(url).endsWith('/auth/logout'));
    expect(sentBody(api, logout)).toEqual({ refreshToken: 'test-refresh-token' });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('is refreshed once when the access token has expired, and the request retried', async () => {
    let healthCalls = 0;
    const api = mockApi({
      'GET /users': (init) =>
        new Headers(init.headers).get('authorization') === 'Bearer fresh-access'
          ? jsonResponse(200, [])
          : jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      'POST /auth/refresh': () =>
        jsonResponse(200, {
          accessToken: 'fresh-access',
          refreshToken: 'fresh-refresh',
          expiresIn: 900,
          tokenType: 'Bearer',
        }),
      'GET /health': () => {
        healthCalls += 1;
        return healthy();
      },
    });
    renderApp('/users', { as: ADMIN });

    expect(await screen.findByText('รายชื่อผู้ใช้')).toBeInTheDocument();
    const refresh = api.mock.calls.findIndex(([url]) => String(url).endsWith('/auth/refresh'));
    expect(sentBody(api, refresh)).toEqual({ refreshToken: 'test-refresh-token' });
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
    });
    expect(healthCalls).toBe(0);
  });

  it('ends when the refresh is refused, and the person is sent to sign in again', async () => {
    mockApi({
      'GET /users': () => jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      'POST /auth/refresh': () => jsonResponse(401, { code: 'SESSION_ENDED' }),
    });
    renderApp('/users', { as: ADMIN });
    expect(await screen.findByRole('heading', { level: 1, name: 'เข้าสู่ระบบ' })).toBeVisible();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('remembered from an earlier visit is checked with the API before the console shows', async () => {
    const api = mockApi({
      'GET /auth/me': () => jsonResponse(200, STAFF),
      'GET /health': healthy,
    });
    useAuthStore.setState({ accessToken: 'old-access', refreshToken: 'old-refresh', user: STAFF });
    const { render } = await import('@testing-library/react');
    const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
    const { AppProviders } = await import('@/app/AppProviders');
    const { routes } = await import('@/app/routes');
    render(
      <AppProviders>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
      </AppProviders>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('กำลังตรวจสอบการเข้าสู่ระบบ');
    expect(await screen.findByRole('heading', { level: 1, name: 'สถานะระบบ' })).toBeVisible();
    expect(String(api.mock.calls[0][0])).toBe('/api/v1/auth/me');
  });
});

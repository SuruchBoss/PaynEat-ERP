import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import { axeViolations, jsonResponse, mockFetch, renderApp, sentHeaders } from '@/test/render';

const healthy = () =>
  mockFetch(async () =>
    jsonResponse(200, { status: 'ok', api: 'up', database: 'up' }, { 'x-request-id': 'ok-000001' }),
  );

describe('console shell', () => {
  it('opens in Thai, inside the shared layout', async () => {
    healthy();
    renderApp('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'สถานะระบบ' })).toBeVisible();
    expect(document.documentElement.lang).toBe('th');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    const nav = screen.getByRole('navigation', { name: 'เมนูหลัก' });
    expect(within(nav).getByRole('link', { name: 'สถานะระบบ' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'ข้ามไปยังเนื้อหาหลัก' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('button', { name: 'ไทย' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to English in one click, remembers it, and sends it to the API', async () => {
    const fetchMock = healthy();
    const user = userEvent.setup();
    const first = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'สถานะระบบ' });
    expect(sentHeaders(fetchMock, 0).get('accept-language')).toBe('th');

    await user.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(sentHeaders(fetchMock, fetchMock.mock.calls.length - 1).get('accept-language')).toBe(
      'en',
    );

    // A new visit on the same browser opens in the remembered language.
    first.unmount();
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
  });

  it('opens in Thai again when the stored choice is not a language it knows', async () => {
    healthy();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'xx');
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'สถานะระบบ' })).toBeVisible();
  });

  it('opens and closes the navigation on small screens', async () => {
    healthy();
    const user = userEvent.setup();
    renderApp('/');

    const toggle = screen.getByRole('button', { name: 'เปิดเมนู' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'primary-nav');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'ปิดเมนู' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows a page-not-found screen inside the layout for unknown paths', async () => {
    renderApp('/no-such-page');

    expect(screen.getByRole('heading', { level: 1, name: 'ไม่พบหน้านี้' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'กลับไปหน้าสถานะระบบ' })).toHaveAttribute('href', '/');
    expect(await axeViolations()).toEqual([]);
  });

  it.each(['th', 'en'])('has no accessibility violations in %s', async (language) => {
    healthy();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    renderApp('/');
    await screen.findByText(language === 'th' ? 'ทุกส่วนทำงานปกติ' : 'Everything is healthy');

    expect(await axeViolations()).toEqual([]);
  });
});

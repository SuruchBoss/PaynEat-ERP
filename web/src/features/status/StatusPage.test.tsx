import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_STORAGE_KEY } from '@/i18n/catalogue';
import { axeViolations, jsonResponse, mockFetch, renderApp } from '@/test/render';

/** The state shown for a component row ("API", "ฐานข้อมูล", …). */
function stateOf(component: string): string {
  const row = screen.getByRole('rowheader', { name: component }).closest('tr');
  if (!row) throw new Error(`no row for ${component}`);
  return within(row).getByRole('cell').textContent ?? '';
}

describe('status screen', () => {
  it('shows every component healthy, and no error, when the API says so', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(
        200,
        { status: 'ok', api: 'up', database: 'up' },
        { 'x-request-id': 'ok-01234' },
      ),
    );
    renderApp('/');

    expect(await screen.findByText('ทุกส่วนทำงานปกติ')).toHaveAttribute('role', 'status');
    expect(fetchMock.mock.calls[0][0]).toBe('/health');
    expect(stateOf('API')).toBe('ปกติ');
    expect(stateOf('ฐานข้อมูล')).toBe('ปกติ');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/^ตรวจล่าสุด /)).toBeVisible();
    expect(await axeViolations()).toEqual([]);
  });

  it('shows the database down, with the correlation id to quote, when the API answers 503', async () => {
    mockFetch(async () =>
      jsonResponse(
        503,
        { status: 'unavailable', api: 'up', database: 'down' },
        { 'x-request-id': 'erp-web-00a1b2c3d4e5f607' },
      ),
    );
    renderApp('/');

    expect(await screen.findByText('มีบางส่วนทำงานไม่ปกติ')).toBeVisible();
    expect(stateOf('API')).toBe('ปกติ');
    expect(stateOf('ฐานข้อมูล')).toBe('ขัดข้อง');
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('erp-web-00a1b2c3d4e5f607')).toBeVisible();
    expect(alert).toHaveTextContent('รหัสอ้างอิง (correlation ID)');
    expect(await axeViolations()).toEqual([]);
  });

  it('shows the error and the id from the error body, in English when chosen', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    mockFetch(async () =>
      jsonResponse(500, {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: 'crash-report-0001',
      }),
    );
    renderApp('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The API answered with an error (HTTP 500)');
    expect(within(alert).getByText('crash-report-0001')).toBeVisible();
    expect(screen.getByText('The API cannot be reached')).toBeVisible();
    expect(stateOf('API')).toBe('Not healthy');
    expect(stateOf('Database')).toBe('Unknown');
    expect(await axeViolations()).toEqual([]);
  });

  it('says the API did not answer, with no id to quote, when nothing came back', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderApp('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ไม่ได้รับคำตอบจาก API');
    expect(alert).not.toHaveTextContent('correlation ID');
    expect(stateOf('ฐานข้อมูล')).toBe('ไม่ทราบ');
  });

  it('does not trust an answer that is not a health report', async () => {
    mockFetch(async () => jsonResponse(200, { hello: 'world' }, { 'x-request-id': 'odd-000001' }));
    renderApp('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('API ตอบกลับในรูปแบบที่ระบบไม่รู้จัก');
    expect(within(alert).getByText('odd-000001')).toBeVisible();
  });

  it('checks again on demand and shows the new result', async () => {
    let databaseUp = false;
    mockFetch(async () =>
      databaseUp
        ? jsonResponse(200, { status: 'ok', api: 'up', database: 'up' })
        : jsonResponse(503, { status: 'unavailable', api: 'up', database: 'down' }),
    );
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByText('มีบางส่วนทำงานไม่ปกติ');

    databaseUp = true;
    await user.click(screen.getByRole('button', { name: 'ตรวจอีกครั้ง' }));

    expect(await screen.findByText('ทุกส่วนทำงานปกติ')).toBeVisible();
    expect(stateOf('ฐานข้อมูล')).toBe('ปกติ');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

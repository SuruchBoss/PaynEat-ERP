// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useAuthStore } from '@/stores/auth.store';
import { jsonResponse, mockApi, mockFetch, sentHeaders } from '@/test/render';
import { api } from './api-client';
import { ApiError } from './api-error';

describe('api client', () => {
  it('sends a fresh correlation id the API accepts, and the console language', async () => {
    document.documentElement.lang = 'en';
    const fetchMock = mockFetch(async () => jsonResponse(200, { ok: true }));

    await api.get('/things');
    await api.get('/things');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/things');
    const first = sentHeaders(fetchMock, 0).get('x-request-id');
    const second = sentHeaders(fetchMock, 1).get('x-request-id');
    expect(first).toMatch(/^erp-web-[0-9a-f]{16}$/);
    expect(first).toMatch(/^[\w-]{8,64}$/); // docs/TELEMETRY.md: otherwise the API replaces it
    expect(second).not.toBe(first);
    expect(sentHeaders(fetchMock).get('accept-language')).toBe('en');
  });

  it('leaves the API prefix off unversioned paths and returns the answered correlation id', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(503, { status: 'unavailable' }, { 'x-request-id': 'health-0001' }),
    );

    const response = await api.request('GET', '/health', {
      unversioned: true,
      acceptStatus: [503],
    });

    expect(fetchMock.mock.calls[0][0]).toBe('/health');
    expect(response).toEqual({
      data: { status: 'unavailable' },
      status: 503,
      requestId: 'health-0001',
    });
  });

  it('turns an error body into an ApiError carrying the code and the correlation id', async () => {
    mockFetch(async () =>
      jsonResponse(
        409,
        { statusCode: 409, code: 'CONFLICT', message: 'Already exists', requestId: 'body-id-0001' },
        { 'x-request-id': 'header-id-0001' },
      ),
    );

    const error = await api.get('/things').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', requestId: 'body-id-0001' });
    expect((error as ApiError).isTerminal).toBe(true);
  });

  it('falls back to the header id when the error body is not JSON (a proxy page)', async () => {
    mockFetch(
      async () =>
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'x-request-id': 'header-id-0002' },
        }),
    );

    await expect(api.get('/things')).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_502',
      requestId: 'header-id-0002',
    });
  });

  it('reports a request that got no answer as unreachable, with no id to quote', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = (await api.get('/things').catch((e: unknown) => e)) as ApiError;

    expect(error.isUnreachable).toBe(true);
    expect(error.requestId).toBeUndefined();
  });

  describe('with a session', () => {
    beforeEach(() => {
      useAuthStore.setState({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    });

    it('sends the access token, except on requests marked anonymous', async () => {
      const fetchMock = mockFetch(async () => jsonResponse(200, {}));
      await api.get('/things');
      await api.post('/auth/login', {}, { anonymous: true });
      expect(sentHeaders(fetchMock, 0).get('authorization')).toBe('Bearer old-access');
      expect(sentHeaders(fetchMock, 1).get('authorization')).toBeNull();
    });

    it('refreshes once for requests that fail together, and retries each of them', async () => {
      let refreshes = 0;
      mockApi({
        'GET /a': (init) => answer(init),
        'GET /b': (init) => answer(init),
        'POST /auth/refresh': async () => {
          refreshes += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return jsonResponse(200, {
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresIn: 900,
            tokenType: 'Bearer',
          });
        },
      });
      function answer(init: RequestInit) {
        return new Headers(init.headers).get('authorization') === 'Bearer new-access'
          ? jsonResponse(200, { ok: true })
          : jsonResponse(401, { code: 'UNAUTHENTICATED' });
      }

      await expect(Promise.all([api.get('/a'), api.get('/b')])).resolves.toEqual([
        { ok: true },
        { ok: true },
      ]);
      expect(refreshes).toBe(1);
      expect(useAuthStore.getState().refreshToken).toBe('new-refresh');
    });

    it('never refreshes for a failed sign-in, which is not an expired session', async () => {
      const fetchMock = mockFetch(async () => jsonResponse(401, { code: 'INVALID_CREDENTIALS' }));
      await expect(api.post('/auth/login', {}, { anonymous: true })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().accessToken).toBe('old-access');
    });
  });
});

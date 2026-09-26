import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { vi } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { routes } from '@/app/routes';
import type { SessionUser } from '@/features/auth/auth.types';
import { useAuthStore } from '@/stores/auth.store';

/** A signed-in person whose roles give no permission yet (anything but admin, today). */
export const STAFF: SessionUser = {
  id: '6c1d0a52-6d8e-4c52-9a55-3d7f0b3a0001',
  email: 'finance@demo-chicken.example',
  displayName: 'Demo finance',
  locale: 'th',
  roles: ['finance'],
  permissions: [],
  mfaEnabled: false,
};

export const ADMIN: SessionUser = {
  id: '6c1d0a52-6d8e-4c52-9a55-3d7f0b3a0002',
  email: 'admin@demo-chicken.example',
  displayName: 'Demo admin',
  locale: 'th',
  roles: ['admin'],
  permissions: ['user:read', 'user:manage', 'audit:read'],
  mfaEnabled: true,
};

export const TOKENS = { accessToken: 'test-access-token', refreshToken: 'test-refresh-token' };

/**
 * The whole console — providers, layout, routes — at `path`, as a person would open it:
 * signed in as `as` (STAFF unless a test says otherwise), or signed out with `as: null`.
 */
export function renderApp(path = '/', { as = STAFF }: { as?: SessionUser | null } = {}) {
  useAuthStore.setState(
    as
      ? { ...TOKENS, user: as, isBootstrapping: false }
      : { accessToken: null, refreshToken: null, user: null, isBootstrapping: false },
  );
  // No retries: an error state should render at once, not after the default back-off.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, queryClient };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Replaces `fetch` for one test; returns the mock so a test can read what was sent. */
export function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * A fake API: answers by `METHOD /path` (path without `/api/v1` and query), and fails the
 * test loudly for anything it was not told about.
 */
export function mockApi(
  routes: Record<string, (init: RequestInit, url: URL) => Response | Promise<Response>>,
) {
  return mockFetch(async (url, init) => {
    const parsed = new URL(url, 'http://console.test');
    const path = parsed.pathname.replace(/^\/api\/v1/, '');
    const key = `${init.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected request ${key}`);
    return handler(init, parsed);
  });
}

/** The JSON body of the `n`-th request `fetchMock` saw. */
export function sentBody(fetchMock: ReturnType<typeof mockFetch>, n = 0): unknown {
  const body = fetchMock.mock.calls[n]?.[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

/** The headers of the `n`-th request `fetchMock` saw. */
export function sentHeaders(fetchMock: ReturnType<typeof mockFetch>, n = 0): Headers {
  return new Headers(fetchMock.mock.calls[n]?.[1]?.headers);
}

/**
 * axe-core violations on the rendered document, as readable lines. Colour contrast is
 * left to `contrast.test.ts`: jsdom does not compute styles, so axe cannot measure it here.
 */
export async function axeViolations(root: Element = document.body): Promise<string[]> {
  const results = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  return results.violations.map(
    (v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

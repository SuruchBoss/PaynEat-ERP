import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { vi } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { routes } from '@/app/routes';

/** The whole console — providers, layout, routes — at `path`, as a person would open it. */
export function renderApp(path = '/') {
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

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Puts the in-browser demo API (#41) in front of `fetch`: a request for one of the API's paths
 * on this origin is answered by `DemoServer`; anything else goes out as usual. The console's
 * own API client is left exactly as it is, so the demo runs the same code a real installation
 * does, tokens, refreshes, request ids and error handling included.
 */
import { DEMO_BUILD_MARKER, DemoServer } from './server';

/** Long enough for loading states to show, short enough not to be in the way. */
const ANSWER_DELAY_MS = 120;

function requestParts(input: RequestInfo | URL, init: RequestInit | undefined, base: string) {
  if (input instanceof Request) {
    return {
      url: new URL(input.url, base),
      method: init?.method ?? input.method,
      headers: new Headers(init?.headers ?? input.headers),
      body: init?.body,
    };
  }
  return {
    url: new URL(input instanceof URL ? input.href : input, base),
    method: init?.method ?? 'GET',
    headers: new Headers(init?.headers),
    body: init?.body,
  };
}

export function installDemoApi(
  target: Window = window,
  server: DemoServer = new DemoServer(),
  delayMs = ANSWER_DELAY_MS,
): DemoServer {
  const passThrough = target.fetch.bind(target);

  target.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = requestParts(input, init, target.location.href);
    if (
      request.url.origin !== target.location.origin ||
      !DemoServer.handles(request.url.pathname)
    ) {
      return passThrough(input, init);
    }

    let body: unknown;
    if (typeof request.body === 'string' && request.body !== '') {
      try {
        body = JSON.parse(request.body);
      } catch {
        body = request.body;
      }
    }
    const answer = await server.handle({
      method: request.method,
      url: request.url.pathname + request.url.search,
      headers: request.headers,
      body,
    });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-request-id': answer.requestId,
      },
    });
  };

  target.document.documentElement.setAttribute('data-demo-api', DEMO_BUILD_MARKER);
  return server;
}

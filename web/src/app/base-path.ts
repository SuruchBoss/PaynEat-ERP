// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The router's basename for the path the console is served under (Vite's `base`, #41): `/`
 * behind nginx, `/PaynEat-ERP/` on GitHub Pages. The router wants it without the trailing
 * slash, so `/items` becomes `/PaynEat-ERP/items`.
 */
export function routerBasename(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

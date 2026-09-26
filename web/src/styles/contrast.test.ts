// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * WCAG AA contrast of the colour pairs the console actually uses, in light and dark mode.
 * axe cannot measure contrast under jsdom (it computes no styles), so this reads the
 * design tokens straight from theme.css instead.
 */
const css = readFileSync(join(__dirname, 'theme.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]),
  );
}

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const light = tokens(css.slice(0, darkStart));
const dark = { ...light, ...tokens(css.slice(darkStart)) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [text, background] as used in app.css. */
const PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-subtle', 'bg'],
  ['text-subtle', 'surface'],
  ['text-inverse', 'brand'],
  ['text-inverse', 'brand-hover'],
  ['brand-text', 'brand-soft'],
  ['brand-text', 'bg'],
  ['success', 'success-soft'],
  ['danger', 'danger-soft'],
  ['danger', 'surface'],
  ['text', 'danger-soft'],
  ['text-subtle', 'danger-soft'],
  ['text', 'neutral-soft'],
  ['text', 'surface-2'],
  ['text-muted', 'surface-2'],
  ['warning', 'warning-soft'],
  ['success', 'surface'],
  // The navigation rail (always dark) and what sits on it.
  ['rail-text', 'rail'],
  ['rail-muted', 'rail'],
  ['rail-text', 'rail-raised'],
  ['rail-muted', 'rail-raised'],
  ['rail-accent', 'rail'],
  ['rail-accent', 'rail-raised'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s mode', (_mode, palette) => {
  it.each(PAIRS)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(palette[fg], fg).toBeDefined();
    expect(palette[bg], bg).toBeDefined();
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

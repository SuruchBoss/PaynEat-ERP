// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { routerBasename } from './base-path';

describe('routerBasename', () => {
  it('keeps the root for a console served at the root', () => {
    expect(routerBasename('/')).toBe('/');
    expect(routerBasename('')).toBe('/');
  });

  it('drops the trailing slash of a sub-path, as the router expects', () => {
    expect(routerBasename('/PaynEat-ERP/')).toBe('/PaynEat-ERP');
    expect(routerBasename('/PaynEat-ERP')).toBe('/PaynEat-ERP');
  });
});

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { compare, subtract } from './decimal';

describe('exact decimals', () => {
  it('subtracts without floating point error', () => {
    expect(subtract('21.6', '21.3')).toBe('0.3');
    expect(subtract('0.3', '0.1', '0.2')).toBe('0');
    expect(subtract('20', '12', '1')).toBe('7');
    expect(subtract('15', '16')).toBe('-1');
    expect(subtract('1.250', '')).toBe('1.25');
  });

  it('refuses anything that is not a plain decimal', () => {
    expect(subtract('20', 'ten')).toBeNull();
    expect(subtract('1e3', '1')).toBeNull();
  });

  it('compares', () => {
    expect(compare('21.6', '21.60')).toBe(0);
    expect(compare('3', '2.999')).toBe(1);
    expect(compare('-1', '0')).toBe(-1);
    expect(compare('x', '0')).toBeNull();
  });
});

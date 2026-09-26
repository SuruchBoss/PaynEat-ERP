// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { formatBusinessDate, groupDigits } from './format';

describe('formatting ledger figures', () => {
  it('groups thousands without touching a digit', () => {
    expect(groupDigits('22716.7')).toBe('22,716.7');
    expect(groupDigits('1234567.000001')).toBe('1,234,567.000001');
    expect(groupDigits('-362.5')).toBe('-362.5');
    expect(groupDigits('-1000')).toBe('-1,000');
    expect(groupDigits('0.013')).toBe('0.013');
    expect(groupDigits('not a number')).toBe('not a number');
  });

  it('shows a business date as the calendar day it is, in either language', () => {
    expect(formatBusinessDate('2026-09-26', 'en')).toBe('26 Sept 2026');
    expect(formatBusinessDate('2026-09-26', 'th')).toContain('2569');
    expect(formatBusinessDate('2026-01-01', 'en')).toBe('1 Jan 2026');
  });
});

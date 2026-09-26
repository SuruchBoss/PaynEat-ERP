// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { addDays, compareDates, dateIn, isIsoDate, isTimeZone } from './business-date';

describe('business dates', () => {
  it('accepts only real calendar dates written YYYY-MM-DD', () => {
    expect(isIsoDate('2026-09-26')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const text of [
      '2026-02-30',
      '2027-02-29',
      '2026-9-26',
      '26-09-2026',
      '2026-09-26T00:00',
      '',
    ]) {
      expect(isIsoDate(text)).toBe(false);
    }
  });

  it('knows a time zone from a typo', () => {
    expect(isTimeZone('Asia/Bangkok')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Asia/Bangkokk')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it("gives the date in the company's time zone, not the server's", () => {
    const lateEveningUtc = new Date('2026-09-26T20:00:00Z');
    expect(dateIn('Asia/Bangkok', lateEveningUtc)).toBe('2026-09-27');
    expect(dateIn('UTC', lateEveningUtc)).toBe('2026-09-26');
    expect(dateIn('Asia/Bangkok', new Date('2026-09-26T16:59:59.999Z'))).toBe('2026-09-26');
    expect(dateIn('Asia/Bangkok', new Date('2026-09-26T17:00:00Z'))).toBe('2026-09-27');
  });

  it('compares and moves dates across month and year ends', () => {
    expect(compareDates('2026-09-26', '2026-10-01')).toBeLessThan(0);
    expect(compareDates('2026-09-26', '2026-09-26')).toBe(0);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-09-26', 0)).toBe('2026-09-26');
  });
});

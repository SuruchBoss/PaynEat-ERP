// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { parseDateInput, showBusinessDate } from './business-date';

describe('showing a business date (#48)', () => {
  it('writes the day first, in the Buddhist era in Thai and the Gregorian year in English', () => {
    expect(showBusinessDate('2026-09-26', 'th')).toBe('26 ก.ย. 2569');
    expect(showBusinessDate('2026-09-26', 'en')).toBe('26 Sep 2026');
    expect(showBusinessDate('2027-01-01', 'th')).toBe('1 ม.ค. 2570');
  });

  it('leaves anything that is not a calendar day as it is', () => {
    expect(showBusinessDate('', 'th')).toBe('');
    expect(showBusinessDate('2026-02-30', 'en')).toBe('2026-02-30');
    expect(showBusinessDate('26/09/2026', 'en')).toBe('26/09/2026');
  });
});

describe('reading a typed date (#48)', () => {
  it.each([
    ['26/9/2569', '2026-09-26'],
    ['26/09/2569', '2026-09-26'],
    ['26-9-2569', '2026-09-26'],
    ['26.9.2569', '2026-09-26'],
    ['26 9 2569', '2026-09-26'],
    ['26 ก.ย. 2569', '2026-09-26'],
    ['26 กย 2569', '2026-09-26'],
    ['26ก.ย.2569', '2026-09-26'],
    ['26 กันยายน 2569', '2026-09-26'],
    ['  26/9/2569  ', '2026-09-26'],
    ['๒๖/๙/๒๕๖๙', '2026-09-26'],
  ])('Thai: %s is %s', (typed, iso) => {
    expect(parseDateInput(typed, 'th')).toEqual({ ok: true, iso });
  });

  it.each([
    ['26/9/2026', '2026-09-26'],
    ['26 Sep 2026', '2026-09-26'],
    ['26 sept 2026', '2026-09-26'],
    ['26 September 2026', '2026-09-26'],
    ['26-Sep-2026', '2026-09-26'],
    ['1 jan 2027', '2027-01-01'],
  ])('English: %s is %s', (typed, iso) => {
    expect(parseDateInput(typed, 'en')).toEqual({ ok: true, iso });
  });

  it('reads back exactly what it shows, in both languages', () => {
    for (const iso of ['2024-02-29', '2025-12-31', '2026-01-01', '2026-09-26']) {
      expect(parseDateInput(showBusinessDate(iso, 'th'), 'th')).toEqual({ ok: true, iso });
      expect(parseDateInput(showBusinessDate(iso, 'en'), 'en')).toEqual({ ok: true, iso });
    }
  });

  it('is never read day and month the other way round', () => {
    expect(parseDateInput('5/10/2569', 'th')).toEqual({ ok: true, iso: '2026-10-05' });
    expect(parseDateInput('10/5/2026', 'en')).toEqual({ ok: true, iso: '2026-05-10' });
  });

  it('treats an empty field as no date', () => {
    expect(parseDateInput('', 'th')).toEqual({ ok: true, iso: '' });
    expect(parseDateInput('   ', 'en')).toEqual({ ok: true, iso: '' });
  });

  describe('29 February', () => {
    it('exists in a leap year, counted on the Gregorian year behind the Buddhist one', () => {
      expect(parseDateInput('29/2/2567', 'th')).toEqual({ ok: true, iso: '2024-02-29' });
      expect(parseDateInput('29 Feb 2024', 'en')).toEqual({ ok: true, iso: '2024-02-29' });
      expect(parseDateInput('29/2/2543', 'th')).toEqual({ ok: true, iso: '2000-02-29' });
    });

    it('does not exist in other years', () => {
      expect(parseDateInput('29/2/2569', 'th')).toEqual({ ok: false, reason: 'no_such_day' });
      expect(parseDateInput('29 Feb 2026', 'en')).toEqual({ ok: false, reason: 'no_such_day' });
      // 2100 is divisible by 4 but not a leap year.
      expect(parseDateInput('29/2/2643', 'th')).toEqual({ ok: false, reason: 'no_such_day' });
    });
  });

  it('crosses the year boundary on the right day', () => {
    expect(parseDateInput('31/12/2568', 'th')).toEqual({ ok: true, iso: '2025-12-31' });
    expect(parseDateInput('1/1/2569', 'th')).toEqual({ ok: true, iso: '2026-01-01' });
    expect(parseDateInput('31 Dec 2025', 'en')).toEqual({ ok: true, iso: '2025-12-31' });
    expect(parseDateInput('1 Jan 2026', 'en')).toEqual({ ok: true, iso: '2026-01-01' });
  });

  it('refuses a Gregorian-looking year in Thai, naming the Buddhist year, and never shifts it', () => {
    expect(parseDateInput('26/9/2026', 'th')).toEqual({
      ok: false,
      reason: 'gregorian_year',
      year: 2026,
      buddhistYear: 2569,
    });
    expect(parseDateInput('29 ก.พ. 2024', 'th')).toEqual({
      ok: false,
      reason: 'gregorian_year',
      year: 2024,
      buddhistYear: 2567,
    });
  });

  it('refuses a Buddhist-era year in English, naming the Gregorian year', () => {
    expect(parseDateInput('26/9/2569', 'en')).toEqual({
      ok: false,
      reason: 'buddhist_year',
      year: 2569,
      gregorianYear: 2026,
    });
  });

  it('refuses a year no business date can have', () => {
    expect(parseDateInput('1/1/1800', 'en')).toEqual({
      ok: false,
      reason: 'out_of_range',
      year: 1800,
    });
    expect(parseDateInput('1/1/3000', 'th')).toEqual({
      ok: false,
      reason: 'out_of_range',
      year: 3000,
    });
  });

  it.each([
    ['26/9', 'th'],
    ['26/9/69', 'th'],
    ['2026-09-26', 'en'],
    ['Sep 26 2026', 'en'],
    ['26 Smarch 2026', 'en'],
    ['next tuesday', 'en'],
  ] as const)('refuses %s as unreadable (%s)', (typed, language) => {
    expect(parseDateInput(typed, language)).toEqual({ ok: false, reason: 'format' });
  });

  it.each([
    ['31/4/2569', 'th'],
    ['0/1/2569', 'th'],
    ['1/13/2026', 'en'],
  ] as const)('refuses %s, a day the calendar does not have (%s)', (typed, language) => {
    expect(parseDateInput(typed, language)).toEqual({ ok: false, reason: 'no_such_day' });
  });
});

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import type { Language } from '@/i18n/catalogue';

/**
 * Business dates as people read and type them (#48). The API always takes and returns an ISO
 * `YYYY-MM-DD` Gregorian calendar day; the console shows it day-first, in the Buddhist era in
 * Thai ("26 ก.ย. 2569") and in the Gregorian year in English ("26 Sep 2026").
 *
 * The month names are written out here rather than taken from `Intl`, because `Intl`'s short
 * names change between ICU versions (English is "Sep" in one browser and "Sept" in the next).
 * Showing and parsing from the same table means a date the console shows can always be typed
 * back exactly as shown.
 */

const MONTHS: Record<Language, { short: readonly string[]; long: readonly string[] }> = {
  th: {
    short: [
      'ม.ค.',
      'ก.พ.',
      'มี.ค.',
      'เม.ย.',
      'พ.ค.',
      'มิ.ย.',
      'ก.ค.',
      'ส.ค.',
      'ก.ย.',
      'ต.ค.',
      'พ.ย.',
      'ธ.ค.',
    ],
    long: [
      'มกราคม',
      'กุมภาพันธ์',
      'มีนาคม',
      'เมษายน',
      'พฤษภาคม',
      'มิถุนายน',
      'กรกฎาคม',
      'สิงหาคม',
      'กันยายน',
      'ตุลาคม',
      'พฤศจิกายน',
      'ธันวาคม',
    ],
  },
  en: {
    short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    long: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
  },
};

/** Years between the Buddhist era and the Gregorian calendar. */
export const BUDDHIST_ERA_OFFSET = 543;

/**
 * The Gregorian years a business date may fall in. Wide enough for any real document and
 * narrow enough that a Buddhist-era year (2443–2743) and a Gregorian one never overlap, so
 * a year typed in the wrong era is always recognised rather than read as a far-off date.
 */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2200;

/** Why a typed date was refused; each one is explained to the person in their language. */
export type DateInputProblem =
  /** Not day, month and four-digit year. */
  | { reason: 'format' }
  /** A day the calendar does not have, such as 31 April or 29 February 2569. */
  | { reason: 'no_such_day' }
  /** Thai mode, a year that looks Gregorian: refused, never shifted by 543 for the person. */
  | { reason: 'gregorian_year'; year: number; buddhistYear: number }
  /** English mode, a year that looks Buddhist-era. */
  | { reason: 'buddhist_year'; year: number; gregorianYear: number }
  /** A four-digit year outside the years any business date can have. */
  | { reason: 'out_of_range'; year: number };

export type DateInputResult = { ok: true; iso: string } | ({ ok: false } & DateInputProblem);

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Splits an ISO calendar day, or returns null for anything that is not one. */
function splitIso(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * A business date (YYYY-MM-DD) as the console shows it: "26 ก.ย. 2569" or "26 Sep 2026".
 * Anything that is not a calendar day is returned unchanged.
 */
export function showBusinessDate(date: string, language: Language): string {
  const parts = splitIso(date);
  if (!parts) return date;
  const year = language === 'th' ? parts.year + BUDDHIST_ERA_OFFSET : parts.year;
  return `${parts.day} ${MONTHS[language].short[parts.month - 1]} ${year}`;
}

/** Lower-cased, without dots or spaces: "ก.ย." → "กย", "Sept" → "sept". */
function monthKey(text: string): string {
  return text.toLowerCase().replace(/[.\s]/g, '');
}

const MONTH_BY_NAME: ReadonlyMap<string, number> = (() => {
  const names = new Map<string, number>();
  for (const { short, long } of Object.values(MONTHS)) {
    short.forEach((name, i) => names.set(monthKey(name), i + 1));
    long.forEach((name, i) => names.set(monthKey(name), i + 1));
  }
  // Older ICU and many people write September as "Sept".
  names.set('sept', 9);
  return names;
})();

const THAI_DIGITS = /[๐-๙]/g;

/**
 * Reads a date typed into the console. Day first, then month (a number, or a month name in
 * either language, with or without dots), then a four-digit year in the era of `language`:
 * "26/9/2569", "26-09-2569", "26 ก.ย. 2569", "26 กันยายน 2569", "26 Sep 2026".
 *
 * An empty text is `{ ok: true, iso: '' }`: no date. A Gregorian-looking year in Thai mode
 * (or a Buddhist-era one in English) is refused with the year the person probably meant; it is
 * never converted on their behalf, because a date 543 years off would post silently.
 */
export function parseDateInput(text: string, language: Language): DateInputResult {
  const normalised = text
    .trim()
    .replace(THAI_DIGITS, (digit) => String(digit.charCodeAt(0) - '๐'.charCodeAt(0)));
  if (normalised === '') return { ok: true, iso: '' };

  const match = /^(\d{1,2})[\s/.,-]*(\d{1,2}|[^\d]+?)[\s/.,-]*(\d+)$/.exec(normalised);
  if (!match) return { ok: false, reason: 'format' };
  const [, dayText, monthText, yearText] = match;
  if (yearText.length !== 4) return { ok: false, reason: 'format' };

  const month = /^\d+$/.test(monthText)
    ? Number(monthText)
    : MONTH_BY_NAME.get(monthKey(monthText));
  if (month === undefined) return { ok: false, reason: 'format' };

  const typedYear = Number(yearText);
  let year: number;
  if (language === 'th') {
    year = typedYear - BUDDHIST_ERA_OFFSET;
    if (year < FIRST_YEAR || year > LAST_YEAR) {
      return typedYear >= FIRST_YEAR && typedYear <= LAST_YEAR
        ? {
            ok: false,
            reason: 'gregorian_year',
            year: typedYear,
            buddhistYear: typedYear + BUDDHIST_ERA_OFFSET,
          }
        : { ok: false, reason: 'out_of_range', year: typedYear };
    }
  } else {
    year = typedYear;
    if (year < FIRST_YEAR || year > LAST_YEAR) {
      const gregorian = typedYear - BUDDHIST_ERA_OFFSET;
      return gregorian >= FIRST_YEAR && gregorian <= LAST_YEAR
        ? { ok: false, reason: 'buddhist_year', year: typedYear, gregorianYear: gregorian }
        : { ok: false, reason: 'out_of_range', year: typedYear };
    }
  }

  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, reason: 'no_such_day' };
  }
  return { ok: true, iso: `${pad(year, 4)}-${pad(month)}-${pad(day)}` };
}

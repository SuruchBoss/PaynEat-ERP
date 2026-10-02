// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import type { Language } from '@/i18n/catalogue';
import { showBusinessDate } from './business-date';

/**
 * Groups the whole part of a decimal string in threes: "22716.7" → "22,716.7". Works on
 * the API's string and never through a floating-point number, so the digits shown are
 * exactly the digits the ledger holds (ADR-0019).
 */
export function groupDigits(text: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = ''] = match;
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`;
}

/**
 * A business date (YYYY-MM-DD, a calendar day in the company's time zone) in the person's
 * language: "26 ก.ย. 2569" or "26 Sep 2026". A calendar day, so the browser's own time zone
 * never moves it, and exactly the text the date field shows and accepts (#48).
 */
export function formatBusinessDate(date: string, language: Language): string {
  return showBusinessDate(date, language);
}

/**
 * A moment (an ISO timestamp) in the browser's time zone: the day as `formatBusinessDate`
 * writes it, so a screen never mixes two spellings of a month, then the time.
 */
export function formatDateTime(value: string, language: Language): string {
  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return value;
  const day = `${moment.getFullYear()}-${String(moment.getMonth() + 1).padStart(2, '0')}-${String(
    moment.getDate(),
  ).padStart(2, '0')}`;
  const time = new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    timeStyle: 'short',
  }).format(moment);
  return `${showBusinessDate(day, language)}${language === 'en' ? ',' : ''} ${time}`;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import type { Language } from '@/i18n/catalogue';

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
 * language. Formatted as a calendar day, so the browser's own time zone never moves it.
 */
export function formatBusinessDate(date: string, language: Language): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatDateTime(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

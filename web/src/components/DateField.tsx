// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { parseDateInput, type DateInputProblem } from '@/lib/business-date';
import { formatBusinessDate } from '@/lib/format';

export interface DateFieldProps {
  /** The input's id; the caller's `<label htmlFor>` points at it. */
  id: string;
  /** The date as the API has it: ISO `YYYY-MM-DD`, or `''` for none. */
  value: string;
  /** Called with an ISO `YYYY-MM-DD` (or `''` when emptied), only ever with a real day. */
  onChange: (value: string) => void;
  /** Ids of the caller's own hints, read after the expected format. */
  describedBy?: string;
  required?: boolean;
  /**
   * For a field repeated on every document line: the expected format is read to a screen
   * reader but not printed under each line, and the field shows an example instead.
   */
  compact?: boolean;
}

function problemMessage(problem: DateInputProblem): { key: MessageKey; params?: MessageParams } {
  switch (problem.reason) {
    case 'format':
      return { key: 'dateField.error.format' };
    case 'no_such_day':
      return { key: 'dateField.error.noSuchDay' };
    case 'gregorian_year':
      return {
        key: 'dateField.error.gregorianYear',
        params: { year: problem.year, buddhistYear: problem.buddhistYear },
      };
    case 'buddhist_year':
      return {
        key: 'dateField.error.buddhistYear',
        params: { year: problem.year, gregorianYear: problem.gregorianYear },
      };
    case 'out_of_range':
      return { key: 'dateField.error.outOfRange', params: { year: problem.year } };
  }
}

/**
 * The console's one date input (#48), used by every date field instead of the browser's
 * `<input type="date">`, which follows the browser's locale rather than the console's.
 *
 * It shows and reads a date day-first in the console's language and calendar ("26 ก.ย. 2569",
 * "26 Sep 2026"; "26/9/2569" can be typed too) and hands the caller an ISO Gregorian day.
 * Text that is not yet a date is never handed on: the caller keeps the last real date, the
 * field explains the problem once the person leaves it, and its form will not submit.
 */
export function DateField({ id, value, onChange, describedBy, required, compact }: DateFieldProps) {
  const { t, language } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => (value ? formatBusinessDate(value, language) : ''));
  const [explain, setExplain] = useState(false);

  // A date set from outside (a reset, another document) or a change of language redraws the
  // text from the value; the person's own typing, once it is the value, is left as typed.
  const [synced, setSynced] = useState({ value, language });
  if (synced.value !== value || synced.language !== language) {
    const typed = parseDateInput(text, synced.language);
    const typedIsValue = typed.ok && typed.iso === value;
    setSynced({ value, language });
    if (!typedIsValue || synced.language !== language) {
      setText(value ? formatBusinessDate(value, language) : '');
    }
    if (!typedIsValue) setExplain(false);
  }

  const parsed = parseDateInput(text, language);
  const problem = parsed.ok ? null : problemMessage(parsed);
  const message = problem ? t(problem.key, problem.params) : '';
  const showProblem = explain && problem !== null;

  // The form's own validation stops a submit while the text is not a date.
  useEffect(() => input.current?.setCustomValidity(message), [message]);

  const formatId = `${id}-format`;
  const errorId = `${id}-error`;
  const describedByIds = [formatId, showProblem ? errorId : null, describedBy]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <input
        ref={input}
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        required={required}
        placeholder={compact ? t('dateField.example') : undefined}
        aria-invalid={showProblem || undefined}
        aria-describedby={describedByIds}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const result = parseDateInput(next, language);
          if (result.ok && result.iso !== value) onChange(result.iso);
        }}
        onBlur={() => {
          setExplain(true);
          if (parsed.ok && parsed.iso) setText(formatBusinessDate(parsed.iso, language));
        }}
        onInvalid={() => setExplain(true)}
      />
      <p id={formatId} className={compact ? 'visually-hidden' : 'subtle'}>
        {t('dateField.format')}
      </p>
      {showProblem && (
        <p id={errorId} className="field-error">
          {message}
        </p>
      )}
    </>
  );
}

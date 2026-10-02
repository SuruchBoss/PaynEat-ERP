// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { LANGUAGE_STORAGE_KEY, type Language } from '@/i18n/catalogue';
import { I18nProvider } from '@/i18n/I18nProvider';
import { useI18n } from '@/i18n/useI18n';
import { axeViolations } from '@/test/render';
import { DateField } from './DateField';

/** A form with one date field, its value as the caller holds it, and a language switch. */
function Harness({
  initial = '',
  onSubmit,
  compact,
}: {
  initial?: string;
  onSubmit?: () => void;
  compact?: boolean;
}) {
  const { language, setLanguage } = useI18n();
  const [value, setValue] = useState(initial);
  return (
    <form
      aria-label="form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <label htmlFor="when">date</label>
      <DateField
        id="when"
        describedBy="when-hint"
        compact={compact}
        value={value}
        onChange={setValue}
      />
      <p id="when-hint">hint</p>
      <output data-testid="value">{value}</output>
      <button type="submit">submit</button>
      <button type="button" onClick={() => setValue('')}>
        reset
      </button>
      <button type="button" onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}>
        switch
      </button>
    </form>
  );
}

function renderField(language: Language, props: Parameters<typeof Harness>[0] = {}) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  render(
    <I18nProvider>
      <Harness {...props} />
    </I18nProvider>,
  );
  return { field: screen.getByLabelText('date'), value: () => screen.getByTestId('value') };
}

describe('date field (#48)', () => {
  it('reads a Thai date day-first in the Buddhist era and hands on an ISO day', async () => {
    const u = userEvent.setup();
    const { field, value } = renderField('th');

    expect(field).toHaveAccessibleDescription(
      'วัน เดือน ปี พ.ศ. เช่น 26/9/2569 หรือ 26 ก.ย. 2569 hint',
    );
    await u.type(field, '26/9/2569');
    expect(value()).toHaveTextContent('2026-09-26');
    await u.tab();
    expect(field).toHaveValue('26 ก.ย. 2569');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(await axeViolations()).toEqual([]);
  });

  it('refuses a Gregorian year in Thai with a hint, hands nothing on, and stops the form', async () => {
    const u = userEvent.setup();
    const submitted = vi.fn();
    const { field, value } = renderField('th', { onSubmit: submitted });

    await u.type(field, '26/9/2026');
    expect(value()).toBeEmptyDOMElement();
    // Nothing is said while the person is still typing.
    expect(field).not.toHaveAttribute('aria-invalid');

    await u.click(screen.getByRole('button', { name: 'submit' }));
    expect(submitted).not.toHaveBeenCalled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining(
        'ปี 2026 ดูเหมือนปี ค.ศ. ช่องนี้ใช้ปี พ.ศ. ถ้าหมายถึง ค.ศ. 2026 ให้พิมพ์ 2569',
      ),
    );
    expect(field).toHaveValue('26/9/2026');
    expect(await axeViolations()).toEqual([]);

    await u.clear(field);
    await u.type(field, '26/9/2569');
    await u.click(screen.getByRole('button', { name: 'submit' }));
    expect(submitted).toHaveBeenCalledOnce();
    expect(value()).toHaveTextContent('2026-09-26');
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('keeps the last real date while the text is being changed into another', async () => {
    const u = userEvent.setup();
    const { field, value } = renderField('th', { initial: '2026-09-26' });

    expect(field).toHaveValue('26 ก.ย. 2569');
    await u.clear(field);
    expect(value()).toBeEmptyDOMElement();
    await u.type(field, '29/2/25');
    expect(value()).toBeEmptyDOMElement();
    await u.type(field, '69');
    await u.tab();
    expect(value()).toBeEmptyDOMElement();
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('ไม่มีวันนี้ในปฏิทิน ตรวจวันและเดือนอีกครั้ง'),
    );
  });

  it('shows English dates as "26 Sep 2026" and refuses a Buddhist-era year there', async () => {
    const u = userEvent.setup();
    const { field, value } = renderField('en', { initial: '2026-09-26' });

    expect(field).toHaveValue('26 Sep 2026');
    expect(field).toHaveAccessibleDescription('Day month year, e.g. 26/9/2026 or 26 Sep 2026 hint');
    await u.clear(field);
    await u.type(field, '1/10/2569');
    await u.tab();
    expect(value()).toBeEmptyDOMElement();
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('2569 looks like a Buddhist-era year.'),
    );
    await u.clear(field);
    await u.type(field, '1 Oct 2026');
    expect(value()).toHaveTextContent('2026-10-01');
  });

  it('redraws the date in the other language, and empties when the caller resets it', async () => {
    const u = userEvent.setup();
    const { field, value } = renderField('th', { initial: '2024-02-29' });

    expect(field).toHaveValue('29 ก.พ. 2567');
    await u.click(screen.getByRole('button', { name: 'switch' }));
    expect(field).toHaveValue('29 Feb 2024');
    expect(value()).toHaveTextContent('2024-02-29');

    await u.click(screen.getByRole('button', { name: 'reset' }));
    expect(field).toHaveValue('');
  });

  it('on a document line, keeps the format for screen readers and shows an example in the field', async () => {
    const { field } = renderField('th', { compact: true });

    expect(field).toHaveAttribute('placeholder', 'เช่น 26/9/2569');
    expect(field).toHaveAccessibleDescription(
      'วัน เดือน ปี พ.ศ. เช่น 26/9/2569 หรือ 26 ก.ย. 2569 hint',
    );
    expect(screen.getByText('วัน เดือน ปี พ.ศ. เช่น 26/9/2569 หรือ 26 ก.ย. 2569')).toHaveClass(
      'visually-hidden',
    );
    expect(await axeViolations()).toEqual([]);
  });
});

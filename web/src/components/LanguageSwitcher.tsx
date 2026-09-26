// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { LANGUAGES } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';

/** One click to the other language; the choice is remembered on this browser. */
export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="lang-switch" role="group" aria-label={t('language.label')}>
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          className="lang-switch__option"
          lang={option}
          aria-pressed={language === option}
          onClick={() => setLanguage(option)}
        >
          {t(`language.${option}`)}
        </button>
      ))}
    </div>
  );
}

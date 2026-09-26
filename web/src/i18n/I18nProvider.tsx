// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  applyDocumentLanguage,
  readStoredLanguage,
  storeLanguage,
  translate,
  type Language,
} from './catalogue';
import { I18nContext, type I18n } from './context';

function initialLanguage(): Language {
  const language = readStoredLanguage();
  // Set before the first render commits, so the very first API request already carries
  // the right Accept-Language (child effects run before a parent's).
  applyDocumentLanguage(language);
  return language;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback((next: Language) => {
    applyDocumentLanguage(next);
    storeLanguage(next);
    setLanguageState(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({ language, setLanguage, t: (key, params) => translate(language, key, params) }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useContext } from 'react';
import { I18nContext, type I18n } from './context';

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error('useI18n() must be used inside <I18nProvider>');
  return i18n;
}

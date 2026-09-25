import { createContext } from 'react';
import type { Language, MessageKey, MessageParams } from './catalogue';

export interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
}

export const I18nContext = createContext<I18n | null>(null);

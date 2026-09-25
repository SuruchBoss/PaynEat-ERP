import { en } from './messages/en';
import { th, type MessageKey, type Messages } from './messages/th';

export type { MessageKey, Messages };

export const LANGUAGES = ['th', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Thai unless the person has chosen otherwise on this browser. */
export const DEFAULT_LANGUAGE: Language = 'th';

export const CATALOGUES: Readonly<Record<Language, Messages>> = { th, en };

/** Where the choice is remembered. Per browser, not per user: the console has no sign-in yet (#4). */
export const LANGUAGE_STORAGE_KEY = 'payneat-erp.language';

export type MessageParams = Readonly<Record<string, string | number>>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** The message for `key` in `language`, with `{name}` placeholders filled from `params`. */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const template = CATALOGUES[language][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

/** Storage can be unavailable (private windows, blocked cookies): fall back, never fail. */
export function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Remembering is a convenience; the switch itself still works for this visit.
  }
}

/**
 * `<html lang>` follows the chosen language: screen readers pick their voice from it, and
 * the API client reads it to send `Accept-Language` without depending on React.
 */
export function applyDocumentLanguage(language: Language): void {
  document.documentElement.lang = language;
}

export function documentLanguage(): Language {
  const lang = document.documentElement.lang;
  return isLanguage(lang) ? lang : DEFAULT_LANGUAGE;
}

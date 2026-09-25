import {
  CATALOGUES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  readStoredLanguage,
  translate,
} from './catalogue';

const THAI = /[฀-๿]/;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('message catalogue', () => {
  const thKeys = Object.keys(CATALOGUES.th).sort();

  it.each(LANGUAGES)('%s translates exactly the keys Thai has', (language) => {
    expect(Object.keys(CATALOGUES[language]).sort()).toEqual(thKeys);
  });

  it.each(LANGUAGES)('%s has no empty message', (language) => {
    const empty = Object.entries(CATALOGUES[language]).filter(([, text]) => !text.trim());
    expect(empty).toEqual([]);
  });

  it('every translation has the same placeholders as the Thai message', () => {
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(CATALOGUES.th)) {
        const translated = CATALOGUES[language][key as keyof typeof CATALOGUES.th];
        expect([language, key, placeholders(translated)]).toEqual([
          language,
          key,
          placeholders(text),
        ]);
      }
    }
  });

  it('English has no Thai left in it, except the name of the Thai language itself', () => {
    const leftovers = Object.entries(CATALOGUES.en).filter(
      ([key, text]) => key !== 'language.th' && THAI.test(text),
    );
    expect(leftovers).toEqual([]);
  });

  it('Thai is the default language', () => {
    expect(DEFAULT_LANGUAGE).toBe('th');
  });
});

describe('translate', () => {
  it('fills placeholders and leaves unknown ones visible rather than blank', () => {
    expect(translate('en', 'status.checkedAt', { time: '10:15' })).toBe('Last checked 10:15');
    expect(translate('th', 'status.error.http', { status: 503 })).toBe(
      'API ตอบกลับด้วยข้อผิดพลาด (HTTP 503)',
    );
    expect(translate('en', 'status.checkedAt')).toBe('Last checked {time}');
  });
});

describe('remembered language', () => {
  it('reads a valid stored choice', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    expect(readStoredLanguage()).toBe('en');
  });

  it('falls back to Thai for anything else, or when storage is unavailable', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    expect(readStoredLanguage()).toBe('th');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(readStoredLanguage()).toBe('th');
  });
});

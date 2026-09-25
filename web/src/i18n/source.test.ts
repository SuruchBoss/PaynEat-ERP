import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findHardcodedStrings, findMessageKeys } from '@/test/hardcoded-strings';
import { CATALOGUES } from './catalogue';

const SRC = join(__dirname, '..');

/** Application source: tests, test helpers and the catalogues themselves are not UI. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === 'test' || name === 'messages' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the scanner itself', () => {
  it('finds text between tags, literal children and readable attributes', () => {
    const code = [
      'export const A = () => (',
      '  <div>',
      '    <h1>Stock on hand</h1>',
      '    <button aria-label="Close">{\'บันทึก\'}</button>',
      '    <img alt={`logo`} src="/x.svg" />',
      '  </div>',
      ');',
    ].join('\n');
    expect(findHardcodedStrings('fixture.tsx', code)).toEqual([
      { line: 3, text: 'Stock on hand' },
      { line: 4, text: 'Close' },
      { line: 4, text: 'บันทึก' },
      { line: 5, text: 'logo' },
    ]);
  });

  it('ignores translated text, punctuation and non-text attributes', () => {
    const code = [
      'export const B = () => (',
      '  <p className="muted" id="x-1" alt="">',
      "    {t('status.title')}: <code>{id}</code> · {' '}",
      '  </p>',
      ');',
    ].join('\n');
    expect(findHardcodedStrings('fixture.tsx', code)).toEqual([]);
  });

  it('collects the keys passed to t() and translate()', () => {
    const code = "t('a.b'); translate(language, 'c.d'); t(dynamicKey);";
    expect(findMessageKeys('fixture.ts', code).map((k) => k.key)).toEqual(['a.b', 'c.d']);
  });
});

describe('console source', () => {
  const files = sourceFiles();

  it('finds the source files at all', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no hard-coded UI text — every string goes through the catalogue', () => {
    const findings = files.flatMap((file) =>
      findHardcodedStrings(file, readFileSync(file, 'utf8')).map(
        (f) => `${relative(SRC, file)}:${f.line} "${f.text}"`,
      ),
    );
    expect(findings).toEqual([]);
  });

  it('uses only message keys that exist in the catalogue', () => {
    const known = new Set(Object.keys(CATALOGUES.th));
    const unknown = files.flatMap((file) =>
      findMessageKeys(file, readFileSync(file, 'utf8'))
        .filter((k) => !known.has(k.key))
        .map((k) => `${relative(SRC, file)}:${k.line} ${k.key}`),
    );
    expect(unknown).toEqual([]);
  });
});

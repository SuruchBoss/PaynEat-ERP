#!/usr/bin/env node
// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0
//
// Checks, or with --fix adds, the copyright and SPDX header on every tracked source file.
// One dependency-free script, the same in every PaynEat ecosystem repository; only CONFIG
// differs. Run: `node scripts/license-headers.mjs` (check) or `... --fix`.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = {
  holder: 'Suruch Chakrapeesirisuk',
  year: 2026,
  // First matching rule wins: [path regex, SPDX identifier].
  licences: [
    [/^ee\//, 'Elastic-2.0'],
    [/.*/, 'Apache-2.0'],
  ],
  // Tracked files never given a header. Applied migrations are here on purpose: their
  // checksum is recorded in every database that ran them, so editing one breaks upgrades.
  exclude: [/(^|\/)node_modules\//, /(^|\/)migrations\//],
};

// Comment syntax by file name. Files whose type is not listed are not checked.
const STYLES = [
  [/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|dart|prisma|swift|kt|kts|gradle)$/, 'line', '//'],
  [/\.(css|scss)$/, 'block', ['/*', ' */']],
  [/\.sql$/, 'line', '--'],
  [/(^|\/)Dockerfile(\.[\w-]+)?$|\.(sh|bash)$/, 'line', '#'],
];

const fix = process.argv.includes('--fix');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const missing = [];
const wrong = [];
for (const file of files) {
  if (CONFIG.exclude.some((re) => re.test(file))) continue;
  const style = STYLES.find(([re]) => re.test(file));
  if (!style) continue;
  const spdx = CONFIG.licences.find(([re]) => re.test(file))[1];
  const text = readFileSync(file, 'utf8');
  const head = text.split('\n').slice(0, 6).join('\n');
  const found = head.match(/SPDX-License-Identifier:\s*([\w.+-]+)/);
  if (found) {
    if (found[1] !== spdx) wrong.push(`${file}: ${found[1]}, expected ${spdx}`);
    continue;
  }
  if (!fix) {
    missing.push(file);
    continue;
  }
  const [, kind, marks] = style;
  const lines = [`Copyright ${CONFIG.year} ${CONFIG.holder}`, `SPDX-License-Identifier: ${spdx}`];
  const header =
    kind === 'line'
      ? lines.map((l) => `${marks} ${l}`).join('\n') + '\n'
      : `${marks[0]}\n${lines.map((l) => ` * ${l}`).join('\n')}\n${marks[1]}\n`;
  // Lines that only work as the very first lines stay there: a shebang, and a Dockerfile's
  // parser directives (`# syntax=`, `# escape=`, `# check=`), which after any comment are
  // silently treated as ordinary comments.
  const first = /^(#!.*|# *(syntax|escape|check) *=.*)\n/i;
  let lead = '';
  for (let m = text.match(first); m; m = text.slice(lead.length).match(first)) lead += m[0];
  const rest = text.slice(lead.length);
  writeFileSync(file, lead + header + (rest.startsWith('\n') ? '' : '\n') + rest);
}

if (wrong.length) {
  console.error(`Wrong licence in the header of ${wrong.length} file(s):\n  ${wrong.join('\n  ')}`);
}
if (missing.length) {
  console.error(
    `Missing copyright/SPDX header in ${missing.length} file(s):\n  ${missing.join('\n  ')}\n` +
      'Run `node scripts/license-headers.mjs --fix` to add it.',
  );
}
if (wrong.length || missing.length) process.exit(1);
if (!fix) console.log('Every source file carries its copyright and SPDX header.');

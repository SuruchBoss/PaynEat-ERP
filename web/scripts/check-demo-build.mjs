// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * What a build of the console carries (#41, ADR-0021). A normal build must hold nothing of
 * the in-browser demo API and none of the demo's published credentials. A demo build
 * (`--demo`) must hold the demo API, the Content-Security-Policy <meta> GitHub Pages cannot
 * send as a header, and a 404.html that is the console itself.
 *
 *   node scripts/check-demo-build.mjs [--demo] [dist directory]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const dist = args.find((arg) => !arg.startsWith('--')) ?? 'dist';

/** web/src/demo/server.ts DEMO_BUILD_MARKER, and the credentials README publishes. */
const DEMO_ONLY = [
  'payneat-erp-in-browser-demo-api',
  'demo-chicken-2026',
  'PAYNEATERPDEMOTWOFACTORSECRET234',
];

const failures = [];
const scripts = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, text: readFileSync(join(dist, 'assets', name), 'utf8') }));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const hasPolicy = /<meta http-equiv="Content-Security-Policy"/.test(html);

for (const marker of DEMO_ONLY) {
  const found = scripts.filter((script) => script.text.includes(marker)).map((s) => s.name);
  if (demo && found.length === 0) failures.push(`the demo build is missing "${marker}"`);
  if (!demo && found.length > 0) failures.push(`"${marker}" is in ${found.join(', ')}`);
}
if (demo && !hasPolicy) failures.push('index.html has no Content-Security-Policy <meta>');
if (!demo && hasPolicy) failures.push('a normal build must leave the policy to its web server');
if (demo) {
  const notFound = join(dist, '404.html');
  if (!existsSync(notFound) || readFileSync(notFound, 'utf8') !== html) {
    failures.push('404.html is not a copy of index.html, so deep links would break on Pages');
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.map((f) => `✗ ${f}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  demo
    ? `✓ ${dist}: the demo API, its policy and 404.html are in the demo build\n`
    : `✓ ${dist}: nothing of the demo API is in this build\n`,
);

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Fails the build when the architecture of ADR-0010 is broken. See
 * scripts/architecture/rules.ts for the rules and rules.spec.ts for each rule failing
 * on a deliberate violation.
 *
 *     npm run check:architecture
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkArchitecture, SourceFile } from './architecture/rules';

const backend = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.ts$/.test(name) ? [path] : [];
  });
}

const files: SourceFile[] = walk(join(backend, 'src')).map((path) => ({
  path: relative(backend, path).split(sep).join('/'),
  content: readFileSync(path, 'utf8'),
}));

const violations = checkArchitecture(files);
if (violations.length > 0) {
  console.error(`Architecture check failed (${violations.length}):`);
  for (const v of violations) console.error(`  [${v.rule}] ${v.file}: ${v.message}`);
  process.exit(1);
}
console.log(`Architecture check passed: ${files.length} files, no violations.`);

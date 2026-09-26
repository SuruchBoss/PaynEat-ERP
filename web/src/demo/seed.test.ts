// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNITS } from './seed';

/** The migration that creates the unit catalogue every installation ships with (#5). */
function migrationUnits() {
  const migrations = join(__dirname, '../../../backend/prisma/migrations');
  const sql = readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrations, entry.name, 'migration.sql'))
    .map((file) => readFileSync(file, 'utf8'))
    .find((text) => text.includes('INSERT INTO "units"'))!;
  const values = sql.slice(sql.indexOf('INSERT INTO "units"')).split(';')[0];
  return [...values.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+)\)/g)]
    .map(([, code, nameTh, nameEn, decimals]) => ({
      code,
      nameTh,
      nameEn,
      decimals: Number(decimals),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

describe('demo unit catalogue (#41)', () => {
  it('is the catalogue the backend migration creates', () => {
    const fromMigration = migrationUnits();
    expect(fromMigration).toHaveLength(13);
    expect([...UNITS]).toEqual(fromMigration);
  });
});

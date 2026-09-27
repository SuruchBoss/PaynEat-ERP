// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The contract in contracts/ checks itself here, in every CI run (#9): every schema compiles,
 * every example validates against its schema, every invalid sales event is refused, the
 * OpenAPI description points only at files that exist, and the API's copy of the sales-event
 * schema is the contract's, byte for byte.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { load } from 'js-yaml';
import { checkSalesEvent } from './sales-event-schema';

const V1 = resolve(__dirname, '../../../../../contracts/pos/v1');
const read = (file: string): unknown => JSON.parse(readFileSync(join(V1, file), 'utf8'));

const SCHEMAS = [
  'sales-event.schema.json',
  'sales-event-receipt.schema.json',
  'master-data-changes.schema.json',
  'pos-instance.schema.json',
  'error.schema.json',
];

const EXAMPLES: Array<[string, string]> = [
  ['examples/sales-event.counted.json', 'sales-event.schema.json'],
  ['examples/sales-event.weighed.json', 'sales-event.schema.json'],
  ['examples/sales-event-receipt.json', 'sales-event-receipt.schema.json'],
  ['examples/sales-event-receipt.duplicate.json', 'sales-event-receipt.schema.json'],
  ['examples/master-data-changes.json', 'master-data-changes.schema.json'],
  ['examples/pos-instance.json', 'pos-instance.schema.json'],
  ['examples/error.schema-invalid.json', 'error.schema.json'],
  ['examples/error.credential-revoked.json', 'error.schema.json'],
];

describe('the POS contract v1 (contracts/pos/v1)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  const validators = new Map(SCHEMAS.map((file) => [file, ajv.compile(read(file) as object)]));

  it('keeps the API copy of the sales-event schema identical to the contract', () => {
    const contract = readFileSync(join(V1, 'sales-event.schema.json'), 'utf8');
    const copy = readFileSync(join(__dirname, 'sales-event.schema.json'), 'utf8');
    expect(copy).toBe(contract);
  });

  it.each(EXAMPLES)('%s is a valid %s', (example, schema) => {
    const validate = validators.get(schema)!;
    const ok = validate(read(example));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('names every example it validates, and every example is named', () => {
    const files = readdirSync(join(V1, 'examples')).filter((f) => f.endsWith('.json'));
    expect(files.map((f) => `examples/${f}`).sort()).toEqual(EXAMPLES.map(([e]) => e).sort());
  });

  const invalid = readdirSync(join(V1, 'examples/invalid')).filter((f) => f.endsWith('.json'));

  it.each(invalid)('refuses invalid/%s, in the contract and in the API', (file) => {
    const event = read(`examples/invalid/${file}`);
    expect(validators.get('sales-event.schema.json')!(event)).toBe(false);
    expect(checkSalesEvent(event).ok).toBe(false);
  });

  it('accepts the valid sales events in the API too', () => {
    for (const file of ['sales-event.counted.json', 'sales-event.weighed.json']) {
      expect(checkSalesEvent(read(`examples/${file}`))).toMatchObject({ ok: true });
    }
  });

  it('describes the POS endpoints with OpenAPI 3.1, pointing only at files that exist', () => {
    const doc = load(readFileSync(join(V1, 'openapi.yaml'), 'utf8')) as {
      openapi: string;
      info: { version: string };
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('1.0.0');
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/master-data/changes',
      '/api/v1/pos/instance',
      '/api/v1/sales-events',
    ]);
    const files: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if ((key === '$ref' || key === 'externalValue') && typeof value === 'string') {
            if (!value.startsWith('#')) files.push(value);
          } else walk(value);
        }
      }
    };
    walk(doc);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files)
      expect(existsSync(resolve(dirname(join(V1, 'openapi.yaml')), file))).toBe(true);
  });
});

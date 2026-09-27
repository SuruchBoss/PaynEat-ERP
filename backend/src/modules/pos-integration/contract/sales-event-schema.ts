// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Sales event v1 as the ERP checks it: the contract's own JSON Schema, compiled once. The file
 * next to this one is a byte-for-byte copy of contracts/pos/v1/sales-event.schema.json, because
 * the API image is built from `backend/` alone; `contract.spec.ts` fails the build the moment the
 * two differ, so the contract stays the source of truth.
 */
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from './sales-event.schema.json';

export interface SalesEventV1 {
  schemaVersion: 1;
  idempotencyKey: string;
  posInstance: string;
  branchCode: string;
  saleTime: string;
  menuItemCode: string;
  quantity?: string;
  weightKg?: string;
  modifiers: Array<{ code: string; quantity: string }>;
}

export interface SchemaError {
  /** JSON Pointer to the offending value; empty for the event as a whole. */
  path: string;
  message: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validate = ajv.compile<SalesEventV1>(schema);

/** The event, typed, or where it breaks the schema. */
export function checkSalesEvent(
  body: unknown,
): { ok: true; event: SalesEventV1 } | { ok: false; errors: SchemaError[] } {
  if (validate(body)) return { ok: true, event: body };
  return {
    ok: false,
    errors: (validate.errors ?? []).slice(0, 20).map((e) => ({
      path: e.instancePath,
      message: e.message ?? 'is not valid',
    })),
  };
}

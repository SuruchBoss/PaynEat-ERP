// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules of the POS integration (#9, ADR-0002, contracts/README.md): what a POS instance's
 * registration needs, what a machine credential looks like, and which refusals follow a sales
 * event that already matches the schema. Pure: the service does the lookups and the storage.
 */

/** The contract version the ERP serves (contracts/CHANGELOG.md). */
export const CONTRACT_VERSION = '1.1.0';

/** The ecosystem-wide code shape (docs/GLOSSARY.md "Location code"), used for instances too. */
export const POS_INSTANCE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
export const POS_INSTANCE_NAME_MAX = 100;

/** Every machine credential starts with it (contracts/pos/v1/openapi.yaml `posCredential`). */
export const CREDENTIAL_PREFIX = 'pnepos_';
/** 32 random bytes, base64url: 43 characters after the prefix. */
const CREDENTIAL_SHAPE = /^pnepos_[A-Za-z0-9_-]{43}$/;

/** Whether a presented bearer token could be a machine credential at all. */
export function looksLikeCredential(token: string): boolean {
  return CREDENTIAL_SHAPE.test(token);
}

/** The bearer token of an `Authorization` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  return match ? match[1] : null;
}

export type RegistrationProblem =
  'CODE_INVALID' | 'NAME_MISSING' | 'NAME_TOO_LONG' | 'NO_BRANCHES' | 'DUPLICATE_BRANCH';

/** What is wrong with a registration before the branches are looked up, or null. */
export function registrationProblem(input: {
  code: string;
  name: string;
  branchCodes: readonly string[];
}): RegistrationProblem | null {
  if (!POS_INSTANCE_CODE_PATTERN.test(input.code)) return 'CODE_INVALID';
  const name = input.name.trim();
  if (name.length === 0) return 'NAME_MISSING';
  if (name.length > POS_INSTANCE_NAME_MAX) return 'NAME_TOO_LONG';
  if (input.branchCodes.length === 0) return 'NO_BRANCHES';
  if (new Set(input.branchCodes).size !== input.branchCodes.length) return 'DUPLICATE_BRANCH';
  return null;
}

/**
 * The refusal reasons of contracts/pos/v1/error.schema.json, in the order the ERP checks them.
 * They are also the `reason` label of `sales_event.rejected` and `erp_sales_events_total`.
 */
export type SalesEventReason =
  | 'credential_revoked'
  | 'credential_unknown'
  | 'schema_invalid'
  | 'pos_instance_mismatch'
  | 'branch_not_served'
  | 'idempotency_key_reused';

/**
 * After the schema: the event must name the credential's own instance, and a branch that
 * instance serves. Whether the branch is still active does not matter: the sale happened.
 */
export function salesEventRefusal(
  event: { posInstance: string; branchCode: string },
  instance: { code: string; branchCodes: readonly string[] },
): 'pos_instance_mismatch' | 'branch_not_served' | null {
  if (event.posInstance !== instance.code) return 'pos_instance_mismatch';
  if (!instance.branchCodes.includes(event.branchCode)) return 'branch_not_served';
  return null;
}

/**
 * The same JSON text for the same value whatever the order of its keys, so a retried event
 * hashes the same even if the POS serialised it differently.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** An idempotency key doubles as the correlation id only when it has the header's shape. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

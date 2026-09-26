// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The HTTP side of the in-browser demo API (#41): the errors the real API answers with, and
 * the request checks its validation pipe makes (backend `core/errors`, `core/http`: unknown
 * fields refused, strings trimmed, codes upper-cased). A refusal here has the same status,
 * `code` and `details` as the API's, so the console explains it the same way.
 */
import type { UserRecord } from './state';

export class DemoError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DemoError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (resource: string, id?: string) =>
  new DemoError(
    404,
    'RESOURCE_NOT_FOUND',
    id ? `${resource} '${id}' was not found` : `${resource} was not found`,
  );

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new DemoError(409, code, message, details);

export const refused = (code: string, message: string, details?: Record<string, unknown>) =>
  new DemoError(422, code, message, details);

export const unauthenticated = (code: string, message: string) => new DemoError(401, code, message);

/** What a handler is given: the path's parameters, the query, the body and who is asking. */
export interface Context {
  params: string[];
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
  /** Set on every route that needs a session. */
  actor: UserRecord | null;
  /** Milliseconds since the epoch, from the server's clock. */
  now: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (value: string): boolean => UUID.test(value);

/** A path parameter the API reads with `ParseUUIDPipe`. */
export function uuidParam(value: string): string {
  if (!isUuid(value)) {
    throw new DemoError(400, 'VALIDATION_FAILED', 'Validation failed (uuid is expected)');
  }
  return value;
}

export interface TextRule {
  /** Surrounding spaces removed before any check. */
  trim?: boolean;
  upper?: boolean;
  lower?: boolean;
  /** An empty value (after trimming) is stored as none. */
  emptyIsNull?: boolean;
  notEmpty?: boolean;
  max?: number;
  pattern?: RegExp;
  patternMessage?: string;
  email?: boolean;
  uuid?: boolean;
  isoDate?: boolean;
  oneOf?: readonly string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One request body checked the way the API's DTOs check it. Every problem is collected, and
 * `done()` refuses them together with 400 `VALIDATION_FAILED`, as the validation pipe does.
 */
export class Input {
  private readonly source: Record<string, unknown>;
  private readonly prefix: string;
  private readonly problems: string[];

  constructor(body: unknown, allowed: readonly string[], prefix = '', problems: string[] = []) {
    this.prefix = prefix;
    this.problems = problems;
    this.source = isObject(body) ? body : {};
    if (body !== undefined && !isObject(body)) {
      problems.push(`${prefix || 'body '}must be an object`.trim());
    }
    for (const key of Object.keys(this.source)) {
      if (!allowed.includes(key)) problems.push(`${prefix}property ${key} should not exist`);
    }
  }

  has(name: string): boolean {
    return this.source[name] !== undefined;
  }

  /** A text field the request must carry. */
  text(name: string, rule: TextRule = {}): string {
    return this.check(name, this.source[name], rule, false) ?? '';
  }

  /** A text field the request may leave out (undefined) or, with `emptyIsNull`, clear (null). */
  optionalText(name: string, rule: TextRule = {}): string | null | undefined {
    const value = this.source[name];
    if (value === undefined || (value === null && !rule.emptyIsNull)) return undefined;
    if (value === null) return null;
    return this.check(name, value, rule, true);
  }

  int(name: string, rule: { min?: number; max?: number } = {}): number {
    const value = this.source[name];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.problems.push(`${this.prefix}${name} must be an integer number`);
      return 0;
    }
    if (rule.min !== undefined && value < rule.min) {
      this.problems.push(`${this.prefix}${name} must not be less than ${rule.min}`);
    }
    if (rule.max !== undefined && value > rule.max) {
      this.problems.push(`${this.prefix}${name} must not be greater than ${rule.max}`);
    }
    return value;
  }

  optionalInt(name: string, rule: { min?: number; max?: number } = {}): number | undefined {
    return this.source[name] === undefined ? undefined : this.int(name, rule);
  }

  bool(name: string): boolean {
    const value = this.source[name];
    if (typeof value !== 'boolean') {
      this.problems.push(`${this.prefix}${name} must be a boolean value`);
      return false;
    }
    return value;
  }

  optionalBool(name: string): boolean | undefined {
    return this.source[name] === undefined ? undefined : this.bool(name);
  }

  /** An array field, each element handed to `each` with its own prefix. */
  list<T>(
    name: string,
    rule: { max: number; optional?: boolean; unique?: boolean },
    each: (element: unknown, prefix: string, problems: string[]) => T,
  ): T[] | undefined {
    const value = this.source[name];
    if (value === undefined && rule.optional) return undefined;
    if (!Array.isArray(value)) {
      this.problems.push(`${this.prefix}${name} must be an array`);
      return [];
    }
    if (value.length > rule.max) {
      this.problems.push(`${this.prefix}${name} must contain no more than ${rule.max} elements`);
    }
    if (rule.unique && new Set(value).size !== value.length) {
      this.problems.push(`All ${this.prefix}${name}'s elements must be unique`);
    }
    return value.map((element, index) =>
      each(element, `${this.prefix}${name}.${index}.`, this.problems),
    );
  }

  /** Refuses the request if anything was wrong with it. */
  done(): void {
    if (this.problems.length > 0) {
      throw new DemoError(400, 'VALIDATION_FAILED', this.problems.join('; '), [...this.problems]);
    }
  }

  private check(
    name: string,
    raw: unknown,
    rule: TextRule,
    optional: boolean,
  ): string | null | undefined {
    const field = `${this.prefix}${name}`;
    if (typeof raw !== 'string') {
      if (raw === undefined && optional) return undefined;
      this.problems.push(`${field} must be a string`);
      return undefined;
    }
    let value = rule.trim || rule.emptyIsNull ? raw.trim() : raw;
    if (rule.upper) value = value.toUpperCase();
    if (rule.lower) value = value.toLowerCase();
    if (rule.emptyIsNull && value === '') return null;
    if (rule.notEmpty && value === '') this.problems.push(`${field} should not be empty`);
    if (rule.max !== undefined && value.length > rule.max) {
      this.problems.push(`${field} must be shorter than or equal to ${rule.max} characters`);
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      this.problems.push(rule.patternMessage ?? `${field} is not valid`);
    }
    if (rule.email && !EMAIL.test(value)) this.problems.push(`${field} must be an email`);
    if (rule.uuid && !UUID.test(value)) this.problems.push(`${field} must be a UUID`);
    if (rule.isoDate && !ISO_DATE.test(value)) {
      this.problems.push(`${field} must be a date written YYYY-MM-DD`);
    }
    if (rule.oneOf && !rule.oneOf.includes(value)) {
      this.problems.push(`${field} must be one of the following values: ${rule.oneOf.join(', ')}`);
    }
    return value;
  }
}

/** A query parameter checked like the API's query DTOs; undefined when absent. */
export function queryValue(
  query: URLSearchParams,
  name: string,
  rule: { oneOf?: readonly string[]; uuid?: boolean; isoDate?: boolean },
): string | undefined {
  const value = query.get(name);
  if (value === null) return undefined;
  const input = new Input({ [name]: value }, [name]);
  input.text(name, rule);
  input.done();
  return value;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** What every log line written while serving one request needs to know about it. */
export interface RequestContext {
  correlationId: string;
  traceId?: string;
  /**
   * The location the request acts on, once the handler knows it: every line the request
   * writes from then on carries it as `location_code` (docs/TELEMETRY.md).
   */
  locationCode?: string;
  /**
   * The POS instance the request comes from, once its machine credential is known: every
   * line the request writes from then on carries it as `pos_instance` (docs/TELEMETRY.md,
   * "POS↔ERP integration lines").
   */
  posInstance?: string;
  /**
   * The ERP document the request acts on, once the handler knows its number: every line the
   * request writes from then on carries it as `document_number` (docs/TELEMETRY.md, "Documents").
   */
  documentNumber?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Lines written outside any request (boot, shutdown) still carry a correlation id,
 * as the contract requires of every line: one id per process, so the lines of one
 * boot can be followed together.
 */
export const PROCESS_CORRELATION_ID = `process-${randomUUID()}`;

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Labels the rest of this request's lines with the location it acts on. */
export function labelRequestLocation(locationCode: string): void {
  const context = storage.getStore();
  if (context) context.locationCode = locationCode;
}

/** Labels the rest of this request's lines with the POS instance it comes from. */
export function labelRequestPosInstance(posInstance: string): void {
  const context = storage.getStore();
  if (context) context.posInstance = posInstance;
}

/** Labels the rest of this request's lines with the document it acts on. */
export function labelRequestDocument(documentNumber: string): void {
  const context = storage.getStore();
  if (context) context.documentNumber = documentNumber;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** What every log line written while serving one request needs to know about it. */
export interface RequestContext {
  correlationId: string;
  traceId?: string;
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

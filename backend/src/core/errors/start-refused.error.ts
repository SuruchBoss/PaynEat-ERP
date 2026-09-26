// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * A deliberate refusal to start, raised during bootstrap after its reason has been
 * written to the log as a CRITICAL line. `main.ts` exits on it without a stack trace:
 * the log line is the explanation, a trace would only bury it.
 */
export class StartRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartRefusedError';
  }
}

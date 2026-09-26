// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import type { Request } from 'express';

/** Where a request came from, as the audit trail keeps it. */
export interface ClientMeta {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * What the audit trail keeps about where a request came from. `req.ip` is the client's
 * address behind the one trusted proxy hop (http-setup.ts). The correlation id is not
 * here: the audit service reads it from the request context itself.
 */
export function clientMeta(req: Request): ClientMeta {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

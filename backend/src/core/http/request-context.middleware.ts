// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/http/request-context.middleware.ts), see NOTICE.
// Cwork's version assigns the correlation id; this one also makes it ambient for
// every log line of the request and writes `http.request.completed` with metrics.
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  acceptRequestId,
  formatLatency,
  parseTraceparent,
  requestPath,
  severityForStatus,
} from '../telemetry/domain/log-record';
import { MetricsService } from '../telemetry/metrics.service';
import { runWithRequestContext, type RequestContext } from '../telemetry/request-context';
import { TelemetryLogger } from '../telemetry/telemetry-logger';

/** Where the exception filter leaves the failure for the completion line to report. */
export const RESPONSE_ERROR = 'telemetryError';

/** Route label for requests no route matched, so unknown paths cannot explode cardinality. */
export const UNMATCHED_ROUTE = 'unmatched';

export type RequestWithId = Request & { id?: string };

/**
 * Registered with `app.use`, ahead of routing, so it also covers requests no route
 * matches. For every request it:
 *
 *  - accepts the caller's `x-request-id` if it matches `^[\w-]{8,64}$`, otherwise
 *    generates one, and returns it in the response header (the error body carries it
 *    too, see AllExceptionsFilter);
 *  - makes that id — and a W3C trace id, if the caller sent one — the ambient context
 *    of every log line written while serving the request;
 *  - on completion writes `http.request.completed` (path without query string, status,
 *    latency as a duration string) and counts the request by route template.
 *
 * Nothing about the request body, query string or headers is logged.
 */
export function requestContextMiddleware(logger: TelemetryLogger, metrics: MetricsService) {
  return (req: RequestWithId, res: Response, next: NextFunction): void => {
    const correlationId = acceptRequestId(req.headers['x-request-id']) ?? randomUUID();
    const traceId = parseTraceparent(req.headers['traceparent']);
    const started = process.hrtime.bigint();

    req.id = correlationId;
    res.setHeader('x-request-id', correlationId);

    // Kept by reference: the handler may label it with a location before the response ends.
    const context: RequestContext = { correlationId, traceId };

    res.once('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      const route = routeTemplate(req);
      const path = requestPath(req.originalUrl ?? req.url);
      const status = res.statusCode;

      metrics.observeRequest(req.method, route, status, elapsedMs / 1000);
      logger.write({
        severity: severityForStatus(status),
        event: 'http.request.completed',
        message: `${req.method} ${path} ${status}`,
        // The response has finished; the ambient context may already be gone.
        correlationId,
        traceId,
        labels: context.locationCode ? { location_code: context.locationCode } : undefined,
        httpRequest: {
          requestMethod: req.method,
          requestUrl: path,
          status,
          latency: formatLatency(elapsedMs),
        },
        error: status >= 500 ? res.locals[RESPONSE_ERROR] : undefined,
      });
    });

    runWithRequestContext(context, next);
  };
}

/** The matched route's template (`/api/v1/documents/:id`), never the concrete path. */
function routeTemplate(req: Request): string {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  const path = typeof route?.path === 'string' ? route.path : undefined;
  if (!path) return UNMATCHED_ROUTE;
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  return `${base}${path}` || '/';
}

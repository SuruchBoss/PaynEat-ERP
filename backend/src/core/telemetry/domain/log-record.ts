// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The shape of one log line, as fixed by docs/TELEMETRY.md v1.1.
 *
 * Pure functions only: no framework, no clock, no I/O. Everything the contract makes
 * checkable — severity names, the latency string, which request ids are accepted,
 * where labels and the trace go in each format — is decided here, so it can be
 * tested with worked examples and cannot drift between call sites.
 */

export const SEVERITIES = ['DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** `default` is vendor-neutral; `gcp` uses the keys Cloud Logging reads specially. */
export type LogFormat = 'default' | 'gcp';

/**
 * Always `app`, `event` and `correlation_id`; the optional ones only when they apply.
 * Every value is a string: labels are filtered and counted, never parsed.
 */
export interface LogLabels {
  app: string;
  event: string;
  correlation_id: string;
  location_code?: string;
  document_number?: string;
  pos_instance?: string;
  rule?: string;
  reason?: string;
}

export interface HttpRequestInfo {
  requestMethod: string;
  /** Path only — never the query string (TELEMETRY.md "Never in logs"). */
  requestUrl: string;
  status: number;
  /** A duration string with an `s` suffix, e.g. `"0.231s"`. */
  latency: string;
}

export interface LogEntry {
  severity: Severity;
  time: Date;
  message: string;
  labels: LogLabels;
  traceId?: string;
  httpRequest?: HttpRequestInfo;
  error?: { type: string; message: string; stack?: string };
}

export interface FormatOptions {
  format: LogFormat;
  /** Needed to write a trace as Cloud Logging's resource name in `gcp` format. */
  gcpProject?: string;
  /** Stack traces are written only when the configured level is DEBUG. */
  includeStack: boolean;
}

const RANK: Record<Severity, number> = {
  DEBUG: 100,
  INFO: 200,
  NOTICE: 300,
  WARNING: 400,
  ERROR: 500,
  CRITICAL: 600,
};

/** Whether a line at `severity` is written when the configured level is `threshold`. */
export function isEnabled(threshold: Severity, severity: Severity): boolean {
  return RANK[severity] >= RANK[threshold];
}

/**
 * Severity of `http.request.completed`: `INFO`; `WARNING` for 4xx except 401 and 404;
 * `ERROR` for 5xx. A 401 or 404 is the API working as designed, not a client mistake
 * worth a warning.
 */
export function severityForStatus(status: number): Severity {
  if (status >= 500) return 'ERROR';
  if (status >= 400 && status !== 401 && status !== 404) return 'WARNING';
  return 'INFO';
}

/** `231.4` ms → `"0.231s"`. Cloud Logging rejects a number in `httpRequest.latency`. */
export function formatLatency(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1000;
  return `${seconds.toFixed(3)}s`;
}

/** `/items/7?search=x` → `/items/7`. Query strings may carry anything, so they never reach a log. */
export function requestPath(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

const REQUEST_ID = /^[\w-]{8,64}$/;

/** The caller's `x-request-id` if it matches `^[\w-]{8,64}$`; otherwise the caller gets a new one. */
export function acceptRequestId(incoming: unknown): string | undefined {
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : undefined;
}

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;

/**
 * The trace id of a W3C `traceparent` header, or undefined. An all-zero trace id is
 * invalid by the W3C specification and is ignored rather than propagated.
 */
export function parseTraceparent(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = TRACEPARENT.exec(header.trim().toLowerCase());
  if (!match || /^0+$/.test(match[1])) return undefined;
  return match[1];
}

const GCP_LABELS = 'logging.googleapis.com/labels';
const GCP_TRACE = 'logging.googleapis.com/trace';

/**
 * The JSON object written for one entry.
 *
 * `default`: `labels` and `trace` as plain keys. `gcp`: the same labels object under
 * `logging.googleapis.com/labels`, and the trace as `projects/<project>/traces/<id>`
 * under `logging.googleapis.com/trace`. Without a project id there is no valid
 * resource name to write, so the trace stays under the plain key rather than being
 * written in a form Cloud Logging would misread.
 */
export function toLogRecord(entry: LogEntry, options: FormatOptions): Record<string, unknown> {
  const record: Record<string, unknown> = {
    severity: entry.severity,
    time: entry.time.toISOString(),
    message: entry.message,
  };

  const labels = cleanLabels(entry.labels);
  if (options.format === 'gcp') record[GCP_LABELS] = labels;
  else record.labels = labels;

  if (entry.traceId) {
    if (options.format === 'gcp' && options.gcpProject) {
      record[GCP_TRACE] = `projects/${options.gcpProject}/traces/${entry.traceId}`;
    } else {
      record.trace = entry.traceId;
    }
  }

  if (entry.httpRequest) record.httpRequest = { ...entry.httpRequest };

  if (entry.error) {
    record.error = {
      type: entry.error.type,
      message: entry.error.message,
      ...(options.includeStack && entry.error.stack ? { stack: entry.error.stack } : {}),
    };
  }

  return record;
}

/** Drops labels that do not apply rather than writing `undefined` or empty strings. */
function cleanLabels(labels: LogLabels): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

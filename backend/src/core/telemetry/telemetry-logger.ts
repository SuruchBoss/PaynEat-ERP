// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.token';
import type { RootConfig } from '../config/configuration';
import { HttpRequestInfo, isEnabled, LogLabels, Severity, toLogRecord } from './domain/log-record';
import { currentRequestContext, PROCESS_CORRELATION_ID } from './request-context';

export const APP_NAME = 'payneat-erp-api';

/** Where finished log lines go. stdout in every deployment; a capture in tests. */
export const LOG_SINK = Symbol('LOG_SINK');
export type LogSink = (line: string) => void;
export const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Lines that are not one of the contract's catalogue events (framework and process
 * lifecycle messages) still need an `event` label. They all share this one value,
 * so a query for catalogue events never has to exclude a zoo of invented names.
 */
export const GENERIC_EVENT = 'app.log';

export interface WriteOptions {
  severity: Severity;
  event: string;
  message: string;
  labels?: Omit<LogLabels, 'app' | 'event' | 'correlation_id'>;
  /** Overrides the ambient request context — needed after a response has finished. */
  correlationId?: string;
  traceId?: string;
  httpRequest?: HttpRequestInfo;
  error?: unknown;
}

/**
 * The one writer of log lines (docs/TELEMETRY.md v1.1): JSON, one object per line on
 * stdout, string `severity`, labels always carrying `app`, `event` and `correlation_id`.
 *
 * Also Nest's logger, so framework messages come out in the same shape. Nest's
 * start-up chatter (module and route registration) is written at DEBUG: useful when
 * asked for, noise at the default INFO.
 */
@Injectable()
export class TelemetryLogger implements LoggerService {
  private static readonly FRAMEWORK_CONTEXTS = new Set([
    'NestFactory',
    'InstanceLoader',
    'RoutesResolver',
    'RouterExplorer',
    'NestApplication',
  ]);

  constructor(
    @Inject(APP_CONFIG) private readonly config: RootConfig,
    @Inject(LOG_SINK) private readonly sink: LogSink,
  ) {}

  write(options: WriteOptions): void {
    const { level, format, gcpProject } = this.config.telemetry;
    if (!isEnabled(level, options.severity)) return;

    const context = currentRequestContext();
    const record = toLogRecord(
      {
        severity: options.severity,
        time: new Date(),
        message: options.message,
        labels: {
          ...options.labels,
          app: APP_NAME,
          event: options.event,
          correlation_id: options.correlationId ?? context?.correlationId ?? PROCESS_CORRELATION_ID,
        },
        traceId: options.traceId ?? context?.traceId,
        httpRequest: options.httpRequest,
        error: describeError(options.error),
      },
      { format, gcpProject, includeStack: level === 'DEBUG' },
    );
    this.sink(JSON.stringify(record));
  }

  // --- Nest LoggerService -----------------------------------------------------

  log(message: unknown, context?: string): void {
    const severity = context && TelemetryLogger.FRAMEWORK_CONTEXTS.has(context) ? 'DEBUG' : 'INFO';
    this.generic(severity, message, context);
  }

  error(message: unknown, stackOrContext?: string, context?: string): void {
    const stack = context ? stackOrContext : undefined;
    const error = stack ? { name: 'Error', message: String(message), stack } : undefined;
    this.write({
      severity: 'ERROR',
      event: GENERIC_EVENT,
      message: withContext(message, context ?? (stack ? undefined : stackOrContext)),
      error,
    });
  }

  warn(message: unknown, context?: string): void {
    this.generic('WARNING', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.generic('DEBUG', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.generic('DEBUG', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.generic('CRITICAL', message, context);
  }

  private generic(severity: Severity, message: unknown, context?: string): void {
    this.write({ severity, event: GENERIC_EVENT, message: withContext(message, context) });
  }
}

function withContext(message: unknown, context?: string): string {
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  return context ? `[${context}] ${text}` : text;
}

/** `{ type, message }` (and a stack, written only at DEBUG) — never the raw object. */
function describeError(
  error: unknown,
): { type: string; message: string; stack?: string } | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error || (typeof error === 'object' && 'message' in error)) {
    const e = error as { name?: string; message?: unknown; stack?: string };
    return { type: e.name ?? 'Error', message: String(e.message), stack: e.stack };
  }
  return { type: 'Error', message: String(error) };
}

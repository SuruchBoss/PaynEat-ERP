// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Boots the real application for e2e tests, configured exactly as `main.ts` does
 * (both call `configureHttp`), with every log line captured instead of printed.
 * Adapted from Cwork (backend/test/utils/test-app.ts), see NOTICE.
 */
import type { Server } from 'node:http';
import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { configureHttp } from 'src/core/http/http-setup';
import { MetricsService } from 'src/core/telemetry/metrics.service';
import { LOG_SINK } from 'src/core/telemetry/telemetry-logger';

// Parsed JSON asserted field by field, like Cwork's `ApiResponse` body: typing it would
// couple the suite to the internals it checks from outside.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LogLine = Record<string, any>;

export interface TestContext {
  app: INestApplication;
  server: Server;
  /** Every line the app wrote, raw, in order. */
  rawLogs: string[];
  /** The same lines parsed; a line that is not JSON fails the test that reads it. */
  logs: () => LogLine[];
  metricsPort: number;
  close: () => Promise<void>;
}

export interface CreateTestAppOptions {
  /**
   * Environment overrides applied while the app is built and left in place for its
   * lifetime — `APP_CONFIG` is rebuilt from `process.env` when the provider is
   * instantiated, so this is how a spec boots the app with, say, LOG_FORMAT=gcp.
   */
  env?: Record<string, string>;
  /** Test-only controllers, for responses no production route gives (a 500, a 400). */
  controllers?: Type<unknown>[];
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestContext> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options.env ?? {})) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  const restoreEnv = (): void => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  const rawLogs: string[] = [];
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(LOG_SINK)
    .useValue((line: string) => rawLogs.push(line))
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureHttp(app);
  await app.init();

  return {
    app,
    server: app.getHttpServer() as Server,
    rawLogs,
    logs: () => rawLogs.map((line) => JSON.parse(line) as LogLine),
    metricsPort: app.get(MetricsService).port(),
    close: async () => {
      await app.close();
      restoreEnv();
    },
  };
}

/** The `http.request.completed` line of the request that carried `requestId`. */
export function completedLine(ctx: TestContext, requestId: string): LogLine {
  const line = ctx.logs().find((l) => {
    const labels = l.labels ?? l['logging.googleapis.com/labels'];
    return labels?.event === 'http.request.completed' && labels?.correlation_id === requestId;
  });
  if (!line) throw new Error(`no http.request.completed line for ${requestId}`);
  return line;
}

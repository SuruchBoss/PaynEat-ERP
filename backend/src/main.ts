// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { StartRefusedError } from './core/errors/start-refused.error';
import { configureHttp } from './core/http/http-setup';
import { TelemetryLogger, GENERIC_EVENT } from './core/telemetry/telemetry-logger';

async function bootstrap(): Promise<void> {
  // Buffered until `configureHttp` installs the telemetry logger, so even the
  // framework's first lines come out as contract-shaped JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = configureHttp(app);

  await app.listen(config.app.port, '0.0.0.0');
  app.get(TelemetryLogger).write({
    severity: 'INFO',
    event: GENERIC_EVENT,
    message: `PaynEat ERP API listening on :${config.app.port} (${config.app.env})`,
  });
}

bootstrap().catch((error: unknown) => {
  // A refusal has already been written as a CRITICAL line saying how to fix it.
  if (error instanceof StartRefusedError) process.exit(1);
  throw error;
});

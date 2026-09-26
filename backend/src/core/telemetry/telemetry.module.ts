// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { LOG_SINK, stdoutSink, TelemetryLogger } from './telemetry-logger';

@Global()
@Module({
  providers: [{ provide: LOG_SINK, useValue: stdoutSink }, TelemetryLogger, MetricsService],
  exports: [TelemetryLogger, MetricsService],
})
export class TelemetryModule {}

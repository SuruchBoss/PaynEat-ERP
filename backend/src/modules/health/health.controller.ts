// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Controller, Get, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../core/security/decorators';
import { HealthReport, HealthService } from './health.service';

// Version-neutral and outside the API prefix, so orchestrators and Docker's health
// check probe a stable path that never moves with an API version bump. (Cwork.) Open to
// anyone and never rate-limited: probes come often and carry no credentials.
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 when the API and its database both answer; 503 with the same body when the database does not. */
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}

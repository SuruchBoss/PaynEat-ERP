// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { APP_CONFIG } from '../../core/config/config.token';
import type { RootConfig } from '../../core/config/configuration';
import { StartRefusedError } from '../../core/errors/start-refused.error';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GENERIC_EVENT, TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { startDecision } from './domain/demo-mode';

/**
 * Keeps the demo seed's accounts, whose password and second-factor secret are published,
 * out of any real installation (#5). A production API refuses to start while one is
 * enabled, unless ERP_DEMO=1 says this is an evaluation; with the flag it starts and says
 * so at every start. The rules themselves are in `domain/demo-mode.ts`.
 */
@Injectable()
export class DemoInstallationService implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_CONFIG) private readonly config: RootConfig,
    private readonly prisma: PrismaService,
    private readonly logger: TelemetryLogger,
  ) {}

  /** Whether this installation runs with ERP_DEMO=1; the console shows a banner if so. */
  isDemo(): boolean {
    return this.config.app.demo;
  }

  async onApplicationBootstrap(): Promise<void> {
    const { isProduction, demo } = this.config.app;
    const decision = startDecision({
      production: isProduction,
      demoFlag: demo,
      // Only counted where the answer matters, so development and the tests start as fast.
      enabledDemoAccounts: isProduction && !demo ? await this.enabledDemoAccounts() : 0,
    });

    if (decision.kind === 'start-as-demo') {
      this.logger.write({ severity: 'WARNING', event: GENERIC_EVENT, message: decision.warning });
    }
    if (decision.kind === 'refuse') {
      this.logger.write({ severity: 'CRITICAL', event: GENERIC_EVENT, message: decision.critical });
      throw new StartRefusedError(decision.critical);
    }
  }

  private async enabledDemoAccounts(): Promise<number> {
    try {
      return await this.prisma.user.count({ where: { demo: true, status: UserStatus.ACTIVE } });
    } catch (error) {
      // The README starts the API before the first `migrate deploy`: with no users table
      // (P2021) or no marker column yet (P2022) there is no demo account to refuse, and
      // the sign-in check still holds once the seed has run.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2021' || error.code === 'P2022')
      ) {
        return 0;
      }
      throw error;
    }
  }
}

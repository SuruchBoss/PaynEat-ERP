// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './core/config/config.module';
import { APP_CONFIG } from './core/config/config.token';
import type { RootConfig } from './core/config/configuration';
import { AllExceptionsFilter } from './core/http/all-exceptions.filter';
import { PrismaModule } from './core/prisma/prisma.module';
import { PermissionsGuard } from './core/security/permissions.guard';
import { TelemetryModule } from './core/telemetry/telemetry.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { ItemsModule } from './modules/items/items.module';
import { MasterDataModule } from './modules/master-data/master-data.module';

/**
 * Modular monolith (ADR-0010). Each feature module owns its tables and exposes a
 * service; modules talk to each other through those services, never through each
 * other's repositories or Prisma models. `npm run check:architecture` enforces it.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    TelemetryModule,
    // In-process counters: right for one API instance, which is what docker-compose.yml
    // runs. Cwork's shared PostgreSQL storage can follow when the ERP runs several.
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: RootConfig) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.security.throttleTtlSeconds * 1000,
            limit: config.security.throttleLimit,
          },
        ],
      }),
    }),
    AuditModule,
    AuthModule,
    HealthModule,
    MasterDataModule,
    ItemsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // In this order: rate limit, then who you are, then what you may do. Every route is
    // authenticated unless it says `@Public()`, so a forgotten guard fails closed.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

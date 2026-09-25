import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './core/config/config.module';
import { AllExceptionsFilter } from './core/http/all-exceptions.filter';
import { PrismaModule } from './core/prisma/prisma.module';
import { TelemetryModule } from './core/telemetry/telemetry.module';
import { HealthModule } from './modules/health/health.module';

/**
 * Modular monolith (ADR-0010). Each feature module owns its tables and exposes a
 * service; modules talk to each other through those services, never through each
 * other's repositories or Prisma models. `npm run check:architecture` enforces it.
 */
@Module({
  imports: [AppConfigModule, PrismaModule, TelemetryModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}

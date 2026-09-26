// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/config/configuration.ts), see NOTICE.
import type { LogFormat, Severity } from '../telemetry/domain/log-record';
import { EnvironmentVariables } from './env.validation';

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  /** ERP_DEMO=1: an evaluation installation whose demo accounts may be used. */
  demo: boolean;
  /** The company's time zone: what "today" is for business dates (ADR-0018). */
  timeZone: string;
}

export interface AuthConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  issuer: string;
  audience: string;
  maxFailedAttempts: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  mfaChallengeTtlSeconds: number;
}

export interface SecurityConfig {
  fieldEncryptionKey: string;
  throttleTtlSeconds: number;
  throttleLimit: number;
  credentialThrottleLimit: number;
}

export interface TelemetryConfig {
  level: Severity;
  format: LogFormat;
  gcpProject?: string;
  metricsPort: number;
}

export interface RootConfig {
  app: AppConfig;
  auth: AuthConfig;
  security: SecurityConfig;
  telemetry: TelemetryConfig;
}

/** Maps flat environment variables onto the typed config tree the app injects. */
export function buildConfig(env: EnvironmentVariables): RootConfig {
  return {
    app: {
      env: env.NODE_ENV,
      isProduction: env.NODE_ENV === 'production',
      port: env.PORT,
      apiPrefix: env.API_PREFIX,
      corsOrigins: env.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      demo: env.ERP_DEMO === '1',
      timeZone: env.COMPANY_TIME_ZONE,
    },
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtlSeconds: env.JWT_ACCESS_TTL,
      refreshTtlSeconds: env.JWT_REFRESH_TTL,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      maxFailedAttempts: env.AUTH_MAX_FAILED_ATTEMPTS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
      mfaChallengeTtlSeconds: env.MFA_CHALLENGE_TTL,
    },
    security: {
      fieldEncryptionKey: env.FIELD_ENCRYPTION_KEY,
      throttleTtlSeconds: env.THROTTLE_TTL,
      throttleLimit: env.THROTTLE_LIMIT,
      credentialThrottleLimit: env.AUTH_THROTTLE_LIMIT,
    },
    telemetry: {
      level: env.LOG_LEVEL as Severity,
      format: env.LOG_FORMAT as LogFormat,
      gcpProject: env.GOOGLE_CLOUD_PROJECT,
      metricsPort: env.METRICS_PORT,
    },
  };
}

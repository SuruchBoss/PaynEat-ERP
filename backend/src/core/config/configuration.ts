// Adapted from Cwork (backend/src/core/config/configuration.ts), see NOTICE.
import type { LogFormat, Severity } from '../telemetry/domain/log-record';
import { EnvironmentVariables } from './env.validation';

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
}

export interface TelemetryConfig {
  level: Severity;
  format: LogFormat;
  gcpProject?: string;
  metricsPort: number;
}

export interface RootConfig {
  app: AppConfig;
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
    },
    telemetry: {
      level: env.LOG_LEVEL as Severity,
      format: env.LOG_FORMAT as LogFormat,
      gcpProject: env.GOOGLE_CLOUD_PROJECT,
      metricsPort: env.METRICS_PORT,
    },
  };
}

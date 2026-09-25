// Adapted from Cwork (backend/src/core/config/env.validation.ts), see NOTICE.
// Only the variables the ERP reads today are here; later tickets add their own
// (authentication secrets arrive with #4, the outbox with #9).
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const toInt = () => Transform(({ value }) => (value === undefined ? undefined : Number(value)));

/**
 * Fail fast on boot rather than at the first request. Every value the app reads
 * at runtime must appear here, so a missing setting is a startup error.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'staging', 'production'])
  NODE_ENV: string = 'development';

  @toInt()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  API_PREFIX: string = 'api';

  @IsString()
  CORS_ORIGINS: string = '';

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsIn(['DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL'])
  LOG_LEVEL: string = 'INFO';

  /**
   * `default` writes the vendor-neutral keys of docs/TELEMETRY.md; `gcp` moves the
   * labels and the trace to the keys Google Cloud Logging reads specially. Self-hosted
   * installations never need to know the second one exists.
   */
  @IsIn(['default', 'gcp'])
  LOG_FORMAT: string = 'default';

  /** Turns an incoming trace id into Cloud Logging's `projects/<id>/traces/<trace>`. */
  @IsOptional()
  @Matches(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, {
    message: 'GOOGLE_CLOUD_PROJECT must be a project id',
  })
  GOOGLE_CLOUD_PROJECT?: string;

  /**
   * Prometheus metrics are served on their own port, never the public API port
   * (docs/TELEMETRY.md: "not exposed publicly"). docker-compose.yml does not
   * publish it; a scraper reaches it inside the network. `0` picks a free port,
   * which is what the tests use.
   */
  @toInt()
  @IsInt()
  @Min(0)
  @Max(65535)
  METRICS_PORT: number = 9464;
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const config = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });

  const errors = validateSync(config, { skipMissingProperties: false, whitelist: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  if (config.NODE_ENV === 'production') {
    assertProductionSafety(config);
  }
  if (config.METRICS_PORT !== 0 && config.METRICS_PORT === config.PORT) {
    throw new Error('METRICS_PORT must differ from PORT: metrics are never served on the API port');
  }

  return config;
}

/**
 * Guardrails that only matter in production. Keeping them here means a
 * misconfigured deploy refuses to start instead of quietly running insecurely.
 */
function assertProductionSafety(config: EnvironmentVariables): void {
  const problems: string[] = [];

  if (!config.CORS_ORIGINS.trim()) {
    problems.push('CORS_ORIGINS must list the exact allowed origins in production');
  }
  if (config.CORS_ORIGINS.includes('*')) {
    problems.push('CORS_ORIGINS must not contain a wildcard in production');
  }
  if (problems.length > 0) {
    throw new Error(
      `Unsafe production configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}

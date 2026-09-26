// Adapted from Cwork (backend/src/core/config/env.validation.ts), see NOTICE.
// Only the variables the ERP reads today are here; later tickets add their own
// (the outbox arrives with #9).
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

  // ---- Authentication (#4) ---------------------------------------------------

  // 32 characters minimum. Short secrets make HS256 forgeable in practice. (Cwork.)
  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET!: string;

  /** Seconds an access token lives. Short: roles are re-read on every request anyway. */
  @toInt()
  @IsInt()
  @Min(60)
  JWT_ACCESS_TTL: number = 900;

  @toInt()
  @IsInt()
  @Min(300)
  JWT_REFRESH_TTL: number = 604800;

  @IsString()
  JWT_ISSUER: string = 'payneat-erp';

  @IsString()
  JWT_AUDIENCE: string = 'payneat-erp-clients';

  /**
   * base64 of a 32-byte AES-256-GCM key (`openssl rand -base64 32`). Encrypts the
   * second-factor secrets at rest; losing it makes them unreadable, so back it up.
   */
  @IsString()
  @Matches(/^[A-Za-z0-9+/]{43}=$/, {
    message: 'FIELD_ENCRYPTION_KEY must be a base64 32-byte key (openssl rand -base64 32)',
  })
  FIELD_ENCRYPTION_KEY!: string;

  /** Requests per THROTTLE_TTL seconds from one address, across the whole API. */
  @toInt()
  @IsInt()
  @Min(1)
  THROTTLE_TTL: number = 60;

  @toInt()
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number = 120;

  /**
   * Requests per minute allowed against the credential endpoints (sign-in, the second
   * factor, enrolment). Much tighter than the global limit on purpose. (Cwork.)
   */
  @toInt()
  @IsInt()
  @Min(3)
  AUTH_THROTTLE_LIMIT: number = 10;

  /** Wrong passwords or codes in a row before the account is locked for a while. */
  @toInt()
  @IsInt()
  @Min(1)
  @Max(20)
  AUTH_MAX_FAILED_ATTEMPTS: number = 5;

  @toInt()
  @IsInt()
  @Min(1)
  AUTH_LOCKOUT_MINUTES: number = 15;

  @toInt()
  @IsInt()
  @Min(8)
  PASSWORD_MIN_LENGTH: number = 12;

  /** Seconds a half-finished sign-in stays resumable while the second factor is pending. */
  @toInt()
  @IsInt()
  @Min(60)
  @Max(1800)
  MFA_CHALLENGE_TTL: number = 300;

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

  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
  if (/change-me/i.test(config.JWT_ACCESS_SECRET) || /change-me/i.test(config.JWT_REFRESH_SECRET)) {
    problems.push('JWT secrets still contain the placeholder value from .env.example');
  }
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

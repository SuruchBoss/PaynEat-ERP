import { validateEnv } from './env.validation';

// Test-only values: long enough to pass validation, never used anywhere real.
const base = {
  DATABASE_URL: 'postgresql://erp:erp@localhost:5432/payneat_erp',
  JWT_ACCESS_SECRET: 'unit-test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'unit-test-refresh-secret-0123456789abcdef',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('validateEnv', () => {
  it('applies the defaults a fresh clone runs with', () => {
    const env = validateEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('INFO');
    expect(env.LOG_FORMAT).toBe('default');
    expect(env.METRICS_PORT).toBe(9464);
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.AUTH_THROTTLE_LIMIT).toBe(10);
    expect(env.AUTH_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(env.PASSWORD_MIN_LENGTH).toBe(12);
  });

  it('refuses to boot without a database', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuses to boot without the authentication secrets', () => {
    const {
      JWT_ACCESS_SECRET: _a,
      JWT_REFRESH_SECRET: _r,
      FIELD_ENCRYPTION_KEY: _k,
      ...rest
    } = base;
    const message = (() => {
      try {
        validateEnv(rest);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toMatch(/JWT_ACCESS_SECRET/);
    expect(message).toMatch(/JWT_REFRESH_SECRET/);
    expect(message).toMatch(/FIELD_ENCRYPTION_KEY/);
  });

  it('refuses short JWT secrets and an encryption key that is not 32 bytes', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /at least 32 characters/,
    );
    expect(() =>
      validateEnv({ ...base, FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32-byte key/);
  });

  it('accepts only the contract severities and formats', () => {
    expect(() => validateEnv({ ...base, LOG_LEVEL: 'info' })).toThrow(/LOG_LEVEL/);
    expect(() => validateEnv({ ...base, LOG_FORMAT: 'stackdriver' })).toThrow(/LOG_FORMAT/);
    expect(validateEnv({ ...base, LOG_FORMAT: 'gcp' }).LOG_FORMAT).toBe('gcp');
  });

  it('never serves metrics on the API port', () => {
    expect(() => validateEnv({ ...base, PORT: '3000', METRICS_PORT: '3000' })).toThrow(
      /METRICS_PORT must differ from PORT/,
    );
    expect(validateEnv({ ...base, METRICS_PORT: '0' }).METRICS_PORT).toBe(0);
  });

  it('refuses an unsafe production configuration', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    const origins = { CORS_ORIGINS: 'https://erp.example.test' };
    expect(() =>
      validateEnv({
        ...base,
        ...origins,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/must differ/);
    expect(() =>
      validateEnv({
        ...base,
        ...origins,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me',
      }),
    ).toThrow(/placeholder/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://erp.example.test,*' }),
    ).toThrow(/wildcard/);
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://erp.example.test' })
        .NODE_ENV,
    ).toBe('production');
  });
});

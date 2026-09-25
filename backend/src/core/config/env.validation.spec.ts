import { validateEnv } from './env.validation';

const base = { DATABASE_URL: 'postgresql://erp:erp@localhost:5432/payneat_erp' };

describe('validateEnv', () => {
  it('applies the defaults a fresh clone runs with', () => {
    const env = validateEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('INFO');
    expect(env.LOG_FORMAT).toBe('default');
    expect(env.METRICS_PORT).toBe(9464);
  });

  it('refuses to boot without a database', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
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
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://erp.example.test,*' }),
    ).toThrow(/wildcard/);
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://erp.example.test' })
        .NODE_ENV,
    ).toBe('production');
  });
});

import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import compression from 'compression';
import helmet from 'helmet';
import { APP_CONFIG } from '../config/config.token';
import type { RootConfig } from '../config/configuration';
import { MetricsService } from '../telemetry/metrics.service';
import { TelemetryLogger } from '../telemetry/telemetry-logger';
import { requestContextMiddleware } from './request-context.middleware';

/**
 * Everything `main.ts` configures on top of `AppModule`, in one place so the end-to-end
 * suite boots exactly what production boots. (Cwork mirrors these lines in its test
 * helper by hand; sharing them removes the chance of the two drifting.)
 */
export function configureHttp(app: INestApplication): RootConfig {
  const config = app.get<RootConfig>(APP_CONFIG);
  const logger = app.get(TelemetryLogger);

  app.useLogger(logger);
  app.use(requestContextMiddleware(logger, app.get(MetricsService)));

  // Trust the first proxy hop so `req.ip` is the real client behind a load balancer,
  // without trusting arbitrary hops. (Cwork.)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: config.app.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
      hsts: config.app.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(compression());

  app.enableCors({
    origin: config.app.corsOrigins.length > 0 ? config.app.corsOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
      'traceparent',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  // Health stays outside the prefix and version, at a path orchestrators can rely on.
  app.setGlobalPrefix(config.app.apiPrefix, { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown keys and reject them outright: mass-assignment is the easiest way
      // to sneak a role or an approver into a payload. (Cwork.)
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  app.enableShutdownHooks();
  return config;
}

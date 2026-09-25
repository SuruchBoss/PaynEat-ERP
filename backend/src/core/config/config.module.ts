// Adapted from Cwork (backend/src/core/config/config.module.ts), see NOTICE.
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { APP_CONFIG } from './config.token';
import { buildConfig, RootConfig } from './configuration';
import { validateEnv } from './env.validation';

/**
 * Wraps @nestjs/config so the rest of the app injects a typed `RootConfig`
 * object instead of reaching for stringly-typed `configService.get('FOO')`.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: (raw) => validateEnv(raw),
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      // ConfigService is injected purely to order this factory after env
      // validation has run; the typed tree is rebuilt from the validated values.
      useFactory: (_configService: ConfigService): RootConfig =>
        buildConfig(validateEnv(process.env as Record<string, unknown>)),
    },
  ],
  exports: [APP_CONFIG, NestConfigModule],
})
export class AppConfigModule {}

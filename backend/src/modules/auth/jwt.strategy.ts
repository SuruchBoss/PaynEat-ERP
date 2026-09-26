// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/modules/auth/jwt.strategy.ts), see NOTICE.
import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_CONFIG } from '../../core/config/config.token';
import type { RootConfig } from '../../core/config/configuration';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { SessionTokensService, type AccessTokenPayload } from './session-tokens.service';
import { UserContextService } from './user-context.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(APP_CONFIG) config: RootConfig,
    private readonly tokens: SessionTokensService,
    private readonly userContext: UserContextService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.auth.accessSecret,
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const userId = await this.tokens.assertLiveAccess(payload);
    const context = await this.userContext.resolve(userId);
    return { ...context, sessionId: payload.sid };
  }
}

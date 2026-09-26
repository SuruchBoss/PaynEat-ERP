// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/modules/auth/auth.module.ts), see NOTICE.
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CryptoService } from '../../core/security/crypto.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { MfaService } from './mfa.service';
import { SessionTokensService } from './session-tokens.service';
import { UserContextService } from './user-context.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Sign-in, second factor, sessions and user administration. Owns the `users`,
 * `user_roles` and `sessions` tables; other modules ask `AuthService`, never Prisma.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({}),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    MfaService,
    SessionTokensService,
    UserContextService,
    UsersService,
    JwtStrategy,
    JwtAuthGuard,
    CryptoService,
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}

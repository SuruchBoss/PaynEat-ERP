// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/modules/auth/user-context.service.ts), see NOTICE.
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { APP_CONFIG } from '../../core/config/config.token';
import type { RootConfig } from '../../core/config/configuration';
import { AuthenticationError } from '../../core/errors/domain.errors';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { permissionsFor } from '../../core/security/permissions';
import { demoSignInAllowed } from './domain/demo-mode';

export type UserContext = Omit<AuthenticatedUser, 'sessionId'>;

interface CacheEntry {
  value: UserContext;
  expiresAt: number;
}

/**
 * Resolves the principal for a request.
 *
 * Roles are read from the database rather than embedded in the access token, so
 * revoking a role takes effect at once (the users service invalidates this cache when
 * it changes one) and, on another instance, within `CACHE_TTL_MS`. (Cwork.)
 */
@Injectable()
export class UserContextService {
  private static readonly CACHE_TTL_MS = 30_000;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: RootConfig,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(userId: string): Promise<UserContext> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        demo: true,
        roles: { select: { role: true }, orderBy: { role: 'asc' } },
      },
    });

    if (!user) throw new UnauthorizedException('Account no longer exists');
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is disabled');
    }
    // A session a demo account holds ends too, not only its next sign-in (#5).
    if (!demoSignInAllowed(user.demo, this.config.app.demo)) {
      throw new AuthenticationError(
        'DEMO_ACCOUNTS_OFF',
        'Demo accounts sign in only on a demo installation (ERP_DEMO=1)',
      );
    }

    const roles = user.roles.map((r) => r.role);
    const value: UserContext = {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      roles,
      permissions: permissionsFor(roles),
    };

    this.cache.set(userId, { value, expiresAt: Date.now() + UserContextService.CACHE_TTL_MS });
    return value;
  }

  /** Call after any role change so the next request sees it. */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}

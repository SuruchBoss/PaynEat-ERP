// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/security/permissions.guard.ts), see NOTICE.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessDeniedError } from '../errors/domain.errors';
import type { AuthenticatedUser } from './current-user';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from './decorators';
import type { PermissionKey } from './permissions';

/**
 * Authorisation gate. Runs after the JWT guard, so `request.user` is populated.
 * A route with no declared permissions is still authenticated, but any route that
 * touches data declares what it needs.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, targets);
    if (!required || required.length === 0) return true;

    const mode =
      this.reflector.getAllAndOverride<'any' | 'all'>(PERMISSIONS_MODE_KEY, targets) ?? 'all';

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new AccessDeniedError('Authentication required');

    const held = new Set(user.permissions);
    const granted =
      mode === 'any' ? required.some((p) => held.has(p)) : required.every((p) => held.has(p));

    if (!granted) {
      const missing = required.filter((p) => !held.has(p));
      throw new AccessDeniedError(
        `Missing permission${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      );
    }
    return true;
  }
}

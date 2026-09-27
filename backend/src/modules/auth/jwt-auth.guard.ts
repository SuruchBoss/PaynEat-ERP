// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Copied from Cwork (backend/src/modules/auth/jwt-auth.guard.ts), see NOTICE.
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  IS_PUBLIC_KEY,
  POS_CREDENTIAL_KEY,
  POS_CREDENTIAL_PREFIX,
} from '../../core/security/decorators';

/**
 * Applied globally: every route is authenticated unless it opts out with
 * `@Public()`. Forgetting a guard therefore fails closed.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;
    // A POS route authenticates its machine credential in the handler (#9).
    const pos = this.reflector.getAllAndOverride<'only' | 'or-session'>(
      POS_CREDENTIAL_KEY,
      targets,
    );
    if (pos === 'only') return true;
    if (pos === 'or-session') {
      const header = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
        .headers.authorization;
      if (typeof header === 'string' && header.startsWith(`Bearer ${POS_CREDENTIAL_PREFIX}`)) {
        return true;
      }
    }
    return super.canActivate(context);
  }
}

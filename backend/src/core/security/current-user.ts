// Adapted from Cwork (backend/src/core/security/current-user.ts), see NOTICE.
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PermissionKey, Role } from './permissions';

/** The authenticated principal, attached to `request.user` by the JWT strategy. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string;
  roles: Role[];
  permissions: PermissionKey[];
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);

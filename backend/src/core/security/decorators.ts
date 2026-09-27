// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/security/decorators.ts), see NOTICE.
import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './permissions';

export const IS_PUBLIC_KEY = 'erp:isPublic';
export const PERMISSIONS_KEY = 'erp:permissions';
export const PERMISSIONS_MODE_KEY = 'erp:permissionsMode';

/** Opts a route out of authentication entirely (sign-in, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const POS_CREDENTIAL_KEY = 'erp:posCredential';

/** Every machine credential starts with it, so a request can say which kind it carries. */
export const POS_CREDENTIAL_PREFIX = 'pnepos_';

/**
 * A route a PaynEat POS calls with its machine credential (#9, contracts/). The session guard
 * lets the request through to the handler, which authenticates the credential itself, so a
 * refused credential is logged and counted as an integration event rather than ending as a
 * bare 401 (docs/TELEMETRY.md). `only`: nothing but a machine credential. `or-session`: a
 * machine credential, or a signed-in person as on any other route.
 */
export const PosCredentialRoute = (mode: 'only' | 'or-session') =>
  SetMetadata(POS_CREDENTIAL_KEY, mode);

/** Caller must hold **every** listed permission. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Caller must hold **at least one** listed permission. */
export const RequireAnyPermission = (...permissions: PermissionKey[]) => {
  const set = SetMetadata(PERMISSIONS_KEY, permissions);
  const mode = SetMetadata(PERMISSIONS_MODE_KEY, 'any');
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    set(target, key as string, descriptor as PropertyDescriptor);
    mode(target, key as string, descriptor as PropertyDescriptor);
  };
};

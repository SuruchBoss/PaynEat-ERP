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

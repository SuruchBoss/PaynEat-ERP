// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/security/permissions.ts and roles.ts), see NOTICE.

/**
 * Every protected endpoint declares the permissions it needs with
 * `@RequirePermissions(...)`; a role is a named bundle of them. Naming is
 * `<resource>:<action>`.
 *
 * Only what exists is listed. Each later issue adds the permissions its endpoints
 * need and gives them to the roles ADR-0008 says should have them, so a role is
 * never described as able to do something the API cannot yet do.
 */
export const Permission = {
  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',
  AUDIT_READ: 'audit:read',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

/**
 * The seven roles of ADR-0008, spelled as the ADR spells them. The Prisma enum
 * `RoleKey` must list exactly these; `users.service.ts` fails the typecheck if they
 * drift apart.
 */
export const ROLE_KEYS = [
  'admin',
  'purchasing',
  'purchasing_approver',
  'plant',
  'logistics',
  'branch_manager',
  'finance',
] as const;

export type Role = (typeof ROLE_KEYS)[number];

/** What each role may do today. Grows with every issue that adds endpoints. */
export const ROLE_PERMISSIONS: Record<Role, readonly PermissionKey[]> = {
  // ADR-0008: manage users, roles, locations, configuration; reopen closed periods.
  admin: [Permission.USER_READ, Permission.USER_MANAGE, Permission.AUDIT_READ],
  // ADR-0008: create and send purchase orders; manage suppliers (from #6 and #10).
  purchasing: [],
  // ADR-0008: approve purchase orders above the approval threshold (from #10).
  purchasing_approver: [],
  // ADR-0008: receive goods, run production orders, manage plant stock.
  plant: [],
  // ADR-0008: dispatch transfers.
  logistics: [],
  // ADR-0008: raise requisitions, receive transfers, count branch stock.
  branch_manager: [],
  // ADR-0008: view costs, variances and valuation; export financial data.
  finance: [],
};

/**
 * Permissions that make an account worth stealing: whoever holds one hands out every
 * other permission. An account holding any of them may not have a session without a
 * second factor — today that is exactly the `admin` role. (Cwork's
 * MFA_REQUIRED_PERMISSIONS, narrowed to what the ERP has.)
 */
export const SECOND_FACTOR_PERMISSIONS: readonly PermissionKey[] = [Permission.USER_MANAGE];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}

/** The union of what the given roles allow, without duplicates, in a stable order. */
export function permissionsFor(roles: readonly Role[]): PermissionKey[] {
  const held = new Set<PermissionKey>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role]) held.add(p);
  return Object.values(Permission).filter((p) => held.has(p));
}

export function requiresSecondFactor(roles: readonly Role[]): boolean {
  const held = permissionsFor(roles);
  return SECOND_FACTOR_PERMISSIONS.some((p) => held.includes(p));
}

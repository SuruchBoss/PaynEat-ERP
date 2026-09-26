// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import type { MessageKey } from '@/i18n/catalogue';

/**
 * The seven roles of ADR-0008, as the API spells them, and the permissions the console
 * checks. Both mirror the backend (`core/security/permissions.ts`); the API stays the
 * enforcement point, the console only avoids showing what it would refuse.
 */
export const ROLES = [
  'admin',
  'purchasing',
  'purchasing_approver',
  'plant',
  'logistics',
  'branch_manager',
  'finance',
] as const;

export type Role = (typeof ROLES)[number];

export const Permission = {
  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',
  AUDIT_READ: 'audit:read',
  /** Create, edit, deactivate items (#5). Reading them needs no permission. */
  ITEM_MANAGE: 'item:manage',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

export const ROLE_LABEL: Record<Role, MessageKey> = {
  admin: 'role.admin',
  purchasing: 'role.purchasing',
  purchasing_approver: 'role.purchasing_approver',
  plant: 'role.plant',
  logistics: 'role.logistics',
  branch_manager: 'role.branch_manager',
  finance: 'role.finance',
};

/** What ADR-0008 says each role does, for the people choosing roles. */
export const ROLE_DESCRIPTION: Record<Role, MessageKey> = {
  admin: 'role.admin.description',
  purchasing: 'role.purchasing.description',
  purchasing_approver: 'role.purchasing_approver.description',
  plant: 'role.plant.description',
  logistics: 'role.logistics.description',
  branch_manager: 'role.branch_manager.description',
  finance: 'role.finance.description',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

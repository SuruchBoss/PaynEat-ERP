// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  isRole,
  Permission,
  permissionsFor,
  requiresSecondFactor,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
} from './permissions';

describe('roles and permissions (ADR-0008)', () => {
  it('has exactly the seven roles of ADR-0008', () => {
    expect([...ROLE_KEYS]).toEqual([
      'admin',
      'purchasing',
      'purchasing_approver',
      'plant',
      'logistics',
      'branch_manager',
      'finance',
    ]);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLE_KEYS].sort());
  });

  it('lets only admin manage users and items and read the audit trail', () => {
    for (const role of ROLE_KEYS) {
      const held = permissionsFor([role]);
      const isAdmin = role === 'admin';
      expect(held.includes(Permission.USER_MANAGE)).toBe(isAdmin);
      expect(held.includes(Permission.AUDIT_READ)).toBe(isAdmin);
      expect(held.includes(Permission.ITEM_MANAGE)).toBe(isAdmin);
      expect(held.includes(Permission.LOCATION_MANAGE)).toBe(isAdmin);
    }
  });

  it('lets admin and purchasing, and nobody else, manage suppliers', () => {
    for (const role of ROLE_KEYS) {
      expect(permissionsFor([role]).includes(Permission.SUPPLIER_MANAGE)).toBe(
        role === 'admin' || role === 'purchasing',
      );
    }
  });

  it('merges several roles without duplicates', () => {
    expect(permissionsFor(['admin', 'finance', 'admin'])).toEqual([
      Permission.USER_READ,
      Permission.USER_MANAGE,
      Permission.AUDIT_READ,
      Permission.ITEM_MANAGE,
      Permission.LOCATION_MANAGE,
      Permission.SUPPLIER_MANAGE,
    ]);
    expect(permissionsFor([])).toEqual([]);
  });

  it('requires a second factor for admin accounts, whatever else they hold', () => {
    expect(requiresSecondFactor(['admin'])).toBe(true);
    expect(requiresSecondFactor(['finance', 'admin'])).toBe(true);
    expect(requiresSecondFactor(['purchasing', 'purchasing_approver'])).toBe(false);
    expect(requiresSecondFactor([])).toBe(false);
  });

  it('recognises role names exactly', () => {
    expect(isRole('branch_manager')).toBe(true);
    expect(isRole('Admin')).toBe(false);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

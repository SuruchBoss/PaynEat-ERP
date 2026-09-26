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

  it('lets only admin manage users and read the audit trail', () => {
    for (const role of ROLE_KEYS) {
      const held = permissionsFor([role]);
      const isAdmin = role === 'admin';
      expect(held.includes(Permission.USER_MANAGE)).toBe(isAdmin);
      expect(held.includes(Permission.AUDIT_READ)).toBe(isAdmin);
    }
  });

  it('merges several roles without duplicates', () => {
    expect(permissionsFor(['admin', 'finance', 'admin'])).toEqual([
      Permission.USER_READ,
      Permission.USER_MANAGE,
      Permission.AUDIT_READ,
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

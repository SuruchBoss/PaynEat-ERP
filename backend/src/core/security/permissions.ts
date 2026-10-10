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
  /** Create, edit, deactivate and reactivate items (#5). Reading needs no permission. */
  ITEM_MANAGE: 'item:manage',
  /** Create, correct, deactivate and supersede locations (#6). Reading needs no permission. */
  LOCATION_MANAGE: 'location:manage',
  /** Create, edit and deactivate suppliers (#6). Reading needs no permission. */
  SUPPLIER_MANAGE: 'supplier:manage',
  /**
   * Draft, post and reverse opening balances (#7). Reading them, and stock on hand, needs no
   * permission.
   */
  OPENING_BALANCE_MANAGE: 'opening_balance:manage',
  /** Draft, edit and submit stock adjustments (#8). Reading them needs no permission. */
  STOCK_ADJUSTMENT_RAISE: 'stock_adjustment:raise',
  /**
   * Approve or reject a submitted stock adjustment, which posts it, and retry the posting of an
   * approved one the ledger refused (#8). Never for a document the approver created (ADR-0008).
   */
  STOCK_ADJUSTMENT_APPROVE: 'stock_adjustment:approve',
  /**
   * Register PaynEat POS instances, issue and revoke their machine credentials (#9). A
   * credential lets a machine deliver sales, so only the admin, who signs in with a second
   * factor, manages them.
   */
  POS_INSTANCE_MANAGE: 'pos_instance:manage',
  /**
   * Read menu items, prices, modifiers and recipes with their theoretical cost (#16): the
   * recipes and costs are commercial information, so reading needs a permission.
   */
  MENU_READ: 'menu:read',
  /**
   * Create and change menu items, prices, modifiers and recipe versions (#16). Menu master
   * data is configuration every POS mirrors (ADR-0002), so only the admin changes it.
   */
  MENU_MANAGE: 'menu:manage',
  /**
   * Read purchase orders (#10): what the company buys, from whom and at what price is commercial
   * information, so reading needs a permission, like the menu's costs.
   */
  PURCHASE_ORDER_READ: 'purchase_order:read',
  /** Draft, edit, submit, mark sent and cancel purchase orders (#10). */
  PURCHASE_ORDER_RAISE: 'purchase_order:raise',
  /**
   * Approve or reject a submitted purchase order above the approval threshold (#10). Never one
   * the approver created (ADR-0008).
   */
  PURCHASE_ORDER_APPROVE: 'purchase_order:approve',
  /** Change the company's settings, such as the purchase approval threshold (#10). */
  COMPANY_SETTINGS_MANAGE: 'company_settings:manage',
  /**
   * Read goods receipts and returns to supplier (#11): they carry what the company paid for each
   * lot, so reading needs a permission, like purchase orders.
   */
  GOODS_RECEIPT_READ: 'goods_receipt:read',
  /** Record what arrived at the dock: draft, edit and submit goods receipts (#11). */
  GOODS_RECEIPT_RECEIVE: 'goods_receipt:receive',
  /**
   * Approve or reject a goods receipt with a finding, which posts it, and retry the posting of an
   * approved one the ledger refused (#11). Never a receipt the approver created (ADR-0008).
   */
  GOODS_RECEIPT_APPROVE: 'goods_receipt:approve',
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
  // Master data is configuration: only the admin maintains items (#5). Connecting a POS is
  // configuration too (#9), and so is the menu every POS mirrors (#16) and the purchase approval
  // threshold (#10).
  admin: [
    Permission.USER_READ,
    Permission.USER_MANAGE,
    Permission.AUDIT_READ,
    Permission.ITEM_MANAGE,
    Permission.LOCATION_MANAGE,
    Permission.SUPPLIER_MANAGE,
    Permission.POS_INSTANCE_MANAGE,
    Permission.MENU_READ,
    Permission.MENU_MANAGE,
    Permission.COMPANY_SETTINGS_MANAGE,
  ],
  // ADR-0008: create and send purchase orders (#10); manage suppliers (#6).
  // Purchasing follows what arrived against its orders (#11).
  purchasing: [
    Permission.SUPPLIER_MANAGE,
    Permission.PURCHASE_ORDER_READ,
    Permission.PURCHASE_ORDER_RAISE,
    Permission.GOODS_RECEIPT_READ,
  ],
  // ADR-0008: approve purchase orders above the approval threshold (#10), and out-of-tolerance
  // receipts (#11).
  purchasing_approver: [
    Permission.PURCHASE_ORDER_READ,
    Permission.PURCHASE_ORDER_APPROVE,
    Permission.GOODS_RECEIPT_READ,
    Permission.GOODS_RECEIPT_APPROVE,
  ],
  // ADR-0008: receive goods, run production orders, manage plant stock. Bringing existing
  // stock in with an opening balance is managing it (#7), and so is adjusting it (#8). Receiving
  // means reading the order being received against (#11).
  plant: [
    Permission.OPENING_BALANCE_MANAGE,
    Permission.STOCK_ADJUSTMENT_RAISE,
    Permission.PURCHASE_ORDER_READ,
    Permission.GOODS_RECEIPT_READ,
    Permission.GOODS_RECEIPT_RECEIVE,
  ],
  // ADR-0008: dispatch transfers.
  logistics: [],
  // ADR-0008: raise requisitions, receive transfers, count branch stock. Adjusting branch
  // stock after a count is raising an adjustment (#8). A branch sells the menu: its manager
  // reads it, with its recipes (#16).
  branch_manager: [Permission.STOCK_ADJUSTMENT_RAISE, Permission.MENU_READ],
  // ADR-0008: view costs, variances and valuation; export financial data. An adjustment
  // changes the value of stock, so finance approves it (#8): never one it created itself.
  // Recipes and their theoretical cost are costs: finance reads them (#16), and so are the
  // prices the company has committed to pay (#10) and what each received lot cost (#11).
  finance: [
    Permission.STOCK_ADJUSTMENT_APPROVE,
    Permission.MENU_READ,
    Permission.PURCHASE_ORDER_READ,
    Permission.GOODS_RECEIPT_READ,
  ],
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

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
  /** Create, correct, deactivate and supersede locations (#6). */
  LOCATION_MANAGE: 'location:manage',
  /** Create, edit and deactivate suppliers: admin and purchasing (#6). */
  SUPPLIER_MANAGE: 'supplier:manage',
  /** Draft, post and reverse opening balances: the plant role (#7). Reading needs none. */
  OPENING_BALANCE_MANAGE: 'opening_balance:manage',
  /** Draft, edit and submit stock adjustments: plant and branch managers (#8). */
  STOCK_ADJUSTMENT_RAISE: 'stock_adjustment:raise',
  /** Approve (which posts) or reject them: finance, never on one they raised (#8). */
  STOCK_ADJUSTMENT_APPROVE: 'stock_adjustment:approve',
  /** Register PaynEat POS instances and manage their credentials: the admin (#9, API only). */
  POS_INSTANCE_MANAGE: 'pos_instance:manage',
  /** Read the menu, its recipes and their theoretical cost: admin, finance, branch managers (#16). */
  MENU_READ: 'menu:read',
  /** Change menu items, prices, modifiers and recipe versions: the admin (#16). */
  MENU_MANAGE: 'menu:manage',
  /** Read purchase orders: purchasing, purchasing approvers, finance (#10) and the plant (#11). */
  PURCHASE_ORDER_READ: 'purchase_order:read',
  /** Draft, edit, submit, mark sent and cancel purchase orders: purchasing (#10). */
  PURCHASE_ORDER_RAISE: 'purchase_order:raise',
  /** Approve or reject them: purchasing approvers, never on one they created (#10). */
  PURCHASE_ORDER_APPROVE: 'purchase_order:approve',
  /** Change the company's settings, such as the purchase approval threshold: the admin (#10). */
  COMPANY_SETTINGS_MANAGE: 'company_settings:manage',
  /** Read goods receipts and returns to supplier: plant, purchasing, approvers, finance (#11). */
  GOODS_RECEIPT_READ: 'goods_receipt:read',
  /** Draft, edit and submit goods receipts: the plant (#11). */
  GOODS_RECEIPT_RECEIVE: 'goods_receipt:receive',
  /** Approve (which posts) or reject receipts with findings: purchasing approvers, never their own (#11). */
  GOODS_RECEIPT_APPROVE: 'goods_receipt:approve',
  /** Read production BOMs, their yields and allocation ratios: admin, plant, finance (#12). */
  PRODUCTION_BOM_READ: 'production_bom:read',
  /** Create BOMs, add and correct their versions: the admin (#12). */
  PRODUCTION_BOM_MANAGE: 'production_bom:manage',
  /** Read production orders, their yields, costs and lot genealogy: plant, finance (#13). */
  PRODUCTION_ORDER_READ: 'production_order:read',
  /** Plan, release, record, post, cancel and reverse production orders: the plant (#13). */
  PRODUCTION_ORDER_RUN: 'production_order:run',
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

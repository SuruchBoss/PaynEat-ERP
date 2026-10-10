// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (web/src/app/navigation.ts), see NOTICE. Labels are message keys, so
// navigation follows the chosen language; an item with a permission is shown only to
// people who hold it.
import type { MessageKey } from '@/i18n/catalogue';
import type { IconName } from '@/components/Icon';
import { Permission, type PermissionKey } from '@/lib/access';

export interface NavItem {
  to: string;
  labelKey: MessageKey;
  icon: IconName;
  permission?: PermissionKey;
}

export interface NavSection {
  id: string;
  headingKey: MessageKey;
  items: NavItem[];
}

export const NAV: readonly NavSection[] = [
  {
    id: 'system',
    headingKey: 'nav.section.system',
    items: [{ to: '/', labelKey: 'nav.status', icon: 'pulse' }],
  },
  {
    id: 'master-data',
    headingKey: 'nav.section.masterData',
    // Anyone signed in reads items; only `item:manage` sees the buttons that change them.
    items: [
      { to: '/items', labelKey: 'nav.items', icon: 'box' },
      { to: '/locations', labelKey: 'nav.locations', icon: 'pin' },
      { to: '/suppliers', labelKey: 'nav.suppliers', icon: 'truck' },
    ],
  },
  {
    id: 'stock',
    headingKey: 'nav.section.stock',
    // Anyone signed in sees stock and its documents (#7, #8); their buttons follow permissions.
    items: [
      { to: '/stock', labelKey: 'nav.stock', icon: 'layers' },
      { to: '/opening-balances', labelKey: 'nav.openingBalances', icon: 'ledger' },
      { to: '/stock-adjustments', labelKey: 'nav.stockAdjustments', icon: 'scale' },
    ],
  },
  {
    id: 'purchasing',
    headingKey: 'nav.section.purchasing',
    // Prices committed to suppliers are commercial: purchasing, approvers and finance (#10).
    items: [
      {
        to: '/purchase-orders',
        labelKey: 'nav.purchaseOrders',
        icon: 'cart',
        permission: Permission.PURCHASE_ORDER_READ,
      },
      // What each received lot cost: plant, purchasing, approvers and finance (#11).
      {
        to: '/goods-receipts',
        labelKey: 'nav.goodsReceipts',
        icon: 'inbox',
        permission: Permission.GOODS_RECEIPT_READ,
      },
    ],
  },
  {
    id: 'production',
    headingKey: 'nav.section.production',
    // How a batch's cost is split is commercial: admin, plant and finance read BOMs (#12).
    items: [
      {
        to: '/production-boms',
        labelKey: 'nav.productionBoms',
        icon: 'split',
        permission: Permission.PRODUCTION_BOM_READ,
      },
      // What each output lot cost and how the cut yielded: plant and finance (#13).
      {
        to: '/production-orders',
        labelKey: 'nav.productionOrders',
        icon: 'factory',
        permission: Permission.PRODUCTION_ORDER_READ,
      },
    ],
  },
  {
    id: 'distribution',
    headingKey: 'nav.section.distribution',
    // What left the plant and what arrived: logistics, plant, branch managers, finance (#14).
    items: [
      {
        to: '/transfers',
        labelKey: 'nav.transfers',
        icon: 'transfer',
        permission: Permission.TRANSFER_READ,
      },
    ],
  },
  {
    id: 'menu',
    headingKey: 'nav.section.menu',
    // Recipes and their costs are commercial: admin, finance and branch managers read them (#16).
    items: [
      { to: '/menu', labelKey: 'nav.menu', icon: 'utensils', permission: Permission.MENU_READ },
      {
        to: '/modifiers',
        labelKey: 'nav.modifiers',
        icon: 'sliders',
        permission: Permission.MENU_READ,
      },
    ],
  },
  {
    id: 'administration',
    headingKey: 'nav.section.administration',
    items: [
      { to: '/users', labelKey: 'nav.users', icon: 'users', permission: Permission.USER_READ },
      {
        to: '/settings',
        labelKey: 'nav.settings',
        icon: 'gear',
        permission: Permission.COMPANY_SETTINGS_MANAGE,
      },
    ],
  },
];

/** The sections and items this person may open; a section left empty is dropped. */
export function visibleNav(permissions: readonly string[]): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.permission || permissions.includes(item.permission),
    ),
  })).filter((section) => section.items.length > 0);
}

/** The section and item a path belongs to, for the top bar's "where am I" line. */
export function locate(
  path: string,
  sections: readonly NavSection[],
): { section: NavSection; item: NavItem } | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.to === '/' ? path === '/' : path === item.to || path.startsWith(`${item.to}/`)) {
        return { section, item };
      }
    }
  }
  return null;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (web/src/app/navigation.ts), see NOTICE. Labels are message keys, so
// navigation follows the chosen language; an item with a permission is shown only to
// people who hold it.
import type { MessageKey } from '@/i18n/catalogue';
import { Permission, type PermissionKey } from '@/lib/access';

export interface NavItem {
  to: string;
  labelKey: MessageKey;
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
    items: [{ to: '/', labelKey: 'nav.status' }],
  },
  {
    id: 'master-data',
    headingKey: 'nav.section.masterData',
    // Anyone signed in reads items; only `item:manage` sees the buttons that change them.
    items: [
      { to: '/items', labelKey: 'nav.items' },
      { to: '/locations', labelKey: 'nav.locations' },
      { to: '/suppliers', labelKey: 'nav.suppliers' },
    ],
  },
  {
    id: 'stock',
    headingKey: 'nav.section.stock',
    // Anyone signed in sees stock and its documents (#7); the plant role changes them.
    items: [
      { to: '/stock', labelKey: 'nav.stock' },
      { to: '/opening-balances', labelKey: 'nav.openingBalances' },
    ],
  },
  {
    id: 'administration',
    headingKey: 'nav.section.administration',
    items: [{ to: '/users', labelKey: 'nav.users', permission: Permission.USER_READ }],
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

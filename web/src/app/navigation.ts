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
    // Anyone signed in sees stock and its documents (#7); the plant role changes them.
    items: [
      { to: '/stock', labelKey: 'nav.stock' },
      { to: '/opening-balances', labelKey: 'nav.openingBalances' },
    ],
  },
  {
    id: 'administration',
    headingKey: 'nav.section.administration',
    items: [
      { to: '/users', labelKey: 'nav.users', icon: 'users', permission: Permission.USER_READ },
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

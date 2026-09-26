// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The console's few icons, drawn inline: no icon package and no request to a CDN (the
 * console makes no third-party requests). Always decorative — the words next to an icon
 * carry the meaning, so every icon is hidden from assistive technology.
 */
export type IconName =
  'pulse' | 'box' | 'users' | 'signOut' | 'menu' | 'close' | 'shield' | 'ledger' | 'scale';

const PATHS: Record<IconName, string> = {
  // System status: a heartbeat line.
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  // Items and units: a carton.
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  // Users and roles: two people.
  users:
    'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6',
  signOut: 'M15 17l5-5-5-5M20 12H9M11 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  // Sign-in facts: a second factor, the audit trail, exact quantities.
  shield: 'M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3ZM9 12l2 2 4-4',
  ledger: 'M6 3h10l3 3v15H6V3ZM9 9h7M9 13h7M9 17h4',
  scale: 'M12 4v16M5 8h14M5 8l-3 6a3 3 0 0 0 6 0L5 8ZM19 8l-3 6a3 3 0 0 0 6 0l-3-6ZM8 20h8',
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

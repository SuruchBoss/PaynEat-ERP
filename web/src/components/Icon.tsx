// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The console's few icons, drawn inline: no icon package and no request to a CDN (the
 * console makes no third-party requests). Always decorative — the words next to an icon
 * carry the meaning, so every icon is hidden from assistive technology.
 */
export type IconName =
  | 'pulse'
  | 'box'
  | 'pin'
  | 'truck'
  | 'users'
  | 'signOut'
  | 'menu'
  | 'close'
  | 'shield'
  | 'ledger'
  | 'scale'
  | 'layers'
  | 'utensils'
  | 'sliders'
  | 'cart'
  | 'inbox'
  | 'gear';

const PATHS: Record<IconName, string> = {
  // System status: a heartbeat line.
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  // Items and units: a carton.
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  // Locations: a map pin.
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21ZM12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  // Suppliers: a delivery truck.
  truck:
    'M3 6h11v10H3V6ZM14 10h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
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
  // Stock on hand: lots stacked on each other.
  layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 12.5l9 5 9-5M3 17l9 5 9-5',
  // Menu (#16): a fork and a knife.
  utensils: 'M7 3v7M5 3v5a2 2 0 0 0 4 0V3M7 10v11M17 3c-2 1-3 3.5-3 6.5V13h3M17 3v18',
  // Modifiers (#16): sliders, a choice set on each line.
  sliders: 'M4 7h10M18 7h2M16 5v4M4 17h4M12 17h8M10 15v4',
  // Purchase orders (#10): a shopping cart.
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6H3v-6l2.5-8Z',
  cart: 'M3 4h2l2.4 11h10.2L20 8H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  // Company settings (#10): a cog.
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
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

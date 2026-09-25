// Adapted from Cwork (web/src/app/navigation.ts), see NOTICE. Labels are message keys, so
// navigation follows the chosen language; permissions arrive with sign-in (#4).
import type { MessageKey } from '@/i18n/catalogue';

export interface NavItem {
  to: string;
  labelKey: MessageKey;
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
];

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import type { MessageKey } from '@/i18n/catalogue';
import type { Timing } from './menu.api';

/** A price's or a recipe version's place in time today, as a badge (#16). */
export const TIMING: Record<Timing, { key: MessageKey; tone: string }> = {
  current: { key: 'menu.timing.current', tone: 'up' },
  scheduled: { key: 'menu.timing.scheduled', tone: 'neutral' },
  past: { key: 'menu.timing.past', tone: 'disabled' },
};

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// `GET /installation` (backend `modules/auth/installation.controller.ts`): open to anyone,
// so the sign-in screen can show the demo banner too.
import { api } from '@/lib/api-client';

export interface InstallationInfo {
  /** ERP_DEMO=1: demo accounts with published passwords may sign in here. */
  demo: boolean;
}

export const fetchInstallation = () =>
  api.get<InstallationInfo>('/installation', { anonymous: true });

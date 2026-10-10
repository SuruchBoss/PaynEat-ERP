// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// The company's settings (backend `modules/company/company.controller.ts`).
import { api } from '@/lib/api-client';
import type { PersonRef } from '@/features/opening-balances/opening-balances.api';

export interface CompanySettings {
  /** Money with two decimals: "20000.00". */
  purchaseApprovalThreshold: string;
  /** Minutes a sale may be dated after its receipt before it is held for a person (#17). */
  saleTimeAheadToleranceMinutes: number;
  /** 0 until the admin first saves the settings. */
  revision: number;
  updated: { by: PersonRef; at: string } | null;
}

export const getCompanySettings = () => api.get<CompanySettings>('/company/settings');

export const updateCompanySettings = (
  revision: number,
  purchaseApprovalThreshold: string,
  saleTimeAheadToleranceMinutes?: number,
) =>
  api.patch<CompanySettings>('/company/settings', {
    revision,
    purchaseApprovalThreshold,
    ...(saleTimeAheadToleranceMinutes === undefined ? {} : { saleTimeAheadToleranceMinutes }),
  });

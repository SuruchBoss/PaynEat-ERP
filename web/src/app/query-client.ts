// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (web/src/app/query-client.ts), see NOTICE.
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-error';

/**
 * Server state lives in TanStack Query, which owns caching, refetching and invalidation.
 * A factory rather than a singleton, so every test starts from an empty cache.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Retrying a 403 or a validation error only wastes time and log space.
          if (error instanceof ApiError && error.isTerminal) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Query keys in one place, so invalidation never guesses at a string. */
export const qk = {
  health: ['health'] as const,
  installation: ['installation'] as const,
  users: ['users'] as const,
  items: ['items'] as const,
  units: ['units'] as const,
  locations: ['locations'] as const,
  suppliers: ['suppliers'] as const,
  stockOnHand: (query: Readonly<Record<string, string>>) => ['stock-on-hand', query] as const,
  stockOnHandAll: ['stock-on-hand'] as const,
  openingBalances: ['opening-balances'] as const,
  openingBalance: (id: string) => ['opening-balances', id] as const,
  stockAdjustments: ['stock-adjustments'] as const,
  stockAdjustment: (id: string) => ['stock-adjustments', id] as const,
  menuItems: ['menu-items'] as const,
  menuItem: (id: string) => ['menu-items', id] as const,
  modifierGroups: ['modifier-groups'] as const,
  recipe: (kind: 'menu' | 'modifier', id: string) => ['recipe', kind, id] as const,
  purchaseOrders: ['purchase-orders'] as const,
  purchaseOrderList: (status: string) => ['purchase-orders', 'list', status] as const,
  purchaseOrder: (id: string) => ['purchase-orders', id] as const,
  companySettings: ['company-settings'] as const,
  goodsReceipts: ['goods-receipts'] as const,
  goodsReceiptList: (status: string, purchaseOrderId = '') =>
    ['goods-receipts', 'list', status, purchaseOrderId] as const,
  goodsReceipt: (id: string) => ['goods-receipts', id] as const,
  goodsReceiptPreview: (input: string) => ['goods-receipts', 'preview', input] as const,
  supplierReturns: (purchaseOrderId: string) => ['supplier-returns', purchaseOrderId] as const,
  productionBoms: ['production-boms'] as const,
  productionBomList: (includeInactive: boolean) =>
    ['production-boms', 'list', includeInactive] as const,
  productionBom: (id: string) => ['production-boms', id] as const,
  productionBomPreview: (input: string) => ['production-boms', 'preview', input] as const,
  productionOrders: ['production-orders'] as const,
  productionOrderList: (status: string) => ['production-orders', 'list', status] as const,
  productionOrder: (id: string) => ['production-orders', id] as const,
  transfers: ['transfers'] as const,
  transferList: (status: string) => ['transfers', 'list', status] as const,
  transfer: (id: string) => ['transfers', id] as const,
  transferReceipt: (id: string) => ['transfers', 'receipt', id] as const,
  inTransit: (asOf: string) => ['transfers', 'in-transit', asOf] as const,
};

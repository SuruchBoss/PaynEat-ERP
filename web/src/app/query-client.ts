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
};

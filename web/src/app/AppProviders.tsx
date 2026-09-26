// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nProvider } from '@/i18n/I18nProvider';
import { useAuthStore } from '@/stores/auth.store';
import { createQueryClient } from './query-client';

export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // Once per load: ask the API whether a remembered session is still good.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <I18nProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nProvider>
  );
}

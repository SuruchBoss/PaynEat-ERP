// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = 'th';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // The store is a module singleton: every test starts signed out and unchecked.
  useAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
    isBootstrapping: true,
  });
});

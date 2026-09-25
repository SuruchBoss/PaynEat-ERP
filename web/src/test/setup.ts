import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = 'th';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

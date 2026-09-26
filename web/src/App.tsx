// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppProviders } from './app/AppProviders';
import { routerBasename } from './app/base-path';
import { routes } from './app/routes';

export function App() {
  const [router] = useState(() =>
    createBrowserRouter(routes, { basename: routerBasename(import.meta.env.BASE_URL) }),
  );
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}

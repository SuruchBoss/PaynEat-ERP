// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import type { RouteObject } from 'react-router-dom';
import { SignInPage } from '@/features/auth/SignInPage';
import { ItemsPage } from '@/features/items/ItemsPage';
import { LocationsPage } from '@/features/locations/LocationsPage';
import { NotFoundPage } from '@/features/not-found/NotFoundPage';
import { OpeningBalancesPage } from '@/features/opening-balances/OpeningBalancesPage';
import { StatusPage } from '@/features/status/StatusPage';
import { StockOnHandPage } from '@/features/stock/StockOnHandPage';
import { SuppliersPage } from '@/features/suppliers/SuppliersPage';
import { UsersPage } from '@/features/users/UsersPage';
import { Permission } from '@/lib/access';
import { AppLayout } from './AppLayout';
import { RequireAuth, RequirePermission } from './guards';

/** Shared by the browser router and the tests' memory router. */
export const routes: RouteObject[] = [
  // The only screen open to someone who has not signed in.
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <StatusPage /> },
          { path: 'items', element: <ItemsPage /> },
          { path: 'locations', element: <LocationsPage /> },
          { path: 'suppliers', element: <SuppliersPage /> },
          { path: 'stock', element: <StockOnHandPage /> },
          { path: 'opening-balances', element: <OpeningBalancesPage /> },
          {
            element: <RequirePermission permission={Permission.USER_READ} />,
            children: [{ path: 'users', element: <UsersPage /> }],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

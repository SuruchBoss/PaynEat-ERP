// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import type { RouteObject } from 'react-router-dom';
import { SignInPage } from '@/features/auth/SignInPage';
import { GoodsReceiptsPage } from '@/features/goods-receipts/GoodsReceiptsPage';
import { ItemsPage } from '@/features/items/ItemsPage';
import { LocationsPage } from '@/features/locations/LocationsPage';
import { MenuPage } from '@/features/menu/MenuPage';
import { ModifierGroupsPage } from '@/features/menu/ModifierGroupsPage';
import { NotFoundPage } from '@/features/not-found/NotFoundPage';
import { OpeningBalancesPage } from '@/features/opening-balances/OpeningBalancesPage';
import { ProductionBomsPage } from '@/features/production-boms/ProductionBomsPage';
import { PurchaseOrdersPage } from '@/features/purchase-orders/PurchaseOrdersPage';
import { CompanySettingsPage } from '@/features/settings/CompanySettingsPage';
import { StatusPage } from '@/features/status/StatusPage';
import { StockAdjustmentsPage } from '@/features/stock-adjustments/StockAdjustmentsPage';
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
          { path: 'stock-adjustments', element: <StockAdjustmentsPage /> },
          {
            element: <RequirePermission permission={Permission.MENU_READ} />,
            children: [
              { path: 'menu', element: <MenuPage /> },
              { path: 'modifiers', element: <ModifierGroupsPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.PURCHASE_ORDER_READ} />,
            children: [{ path: 'purchase-orders', element: <PurchaseOrdersPage /> }],
          },
          {
            element: <RequirePermission permission={Permission.GOODS_RECEIPT_READ} />,
            children: [{ path: 'goods-receipts', element: <GoodsReceiptsPage /> }],
          },
          {
            element: <RequirePermission permission={Permission.PRODUCTION_BOM_READ} />,
            children: [{ path: 'production-boms', element: <ProductionBomsPage /> }],
          },
          {
            element: <RequirePermission permission={Permission.USER_READ} />,
            children: [{ path: 'users', element: <UsersPage /> }],
          },
          {
            element: <RequirePermission permission={Permission.COMPANY_SETTINGS_MANAGE} />,
            children: [{ path: 'settings', element: <CompanySettingsPage /> }],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

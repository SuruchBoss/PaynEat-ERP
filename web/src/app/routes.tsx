import type { RouteObject } from 'react-router-dom';
import { NotFoundPage } from '@/features/not-found/NotFoundPage';
import { StatusPage } from '@/features/status/StatusPage';
import { AppLayout } from './AppLayout';
import { RequireAuth } from './guards';

/** Shared by the browser router and the tests' memory router. */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      {
        element: <RequireAuth />,
        children: [{ index: true, element: <StatusPage /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

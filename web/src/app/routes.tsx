import type { RouteObject } from 'react-router-dom';
import { SignInPage } from '@/features/auth/SignInPage';
import { NotFoundPage } from '@/features/not-found/NotFoundPage';
import { StatusPage } from '@/features/status/StatusPage';
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

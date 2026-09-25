// Adapted from Cwork (web/src/app/guards.tsx), see NOTICE.
import { Outlet } from 'react-router-dom';

/**
 * Placeholder until sign-in exists (#4). Every route that will need a signed-in user
 * already sits behind it, so adding the check later changes this file and no route.
 * The API stays the enforcement point either way; a guard only avoids showing a screen
 * the API would refuse.
 */
export function RequireAuth() {
  return <Outlet />;
}

// Adapted from Cwork (web/src/app/guards.tsx), see NOTICE.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '@/i18n/useI18n';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Route guards mirror the server's permissions so the console never renders a screen the
 * API would refuse. The API remains the enforcement point; this only avoids dead ends.
 */
export function RequireAuth() {
  const { t } = useI18n();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <p className="page muted" role="status">
        {t('auth.checkingSession')}
      </p>
    );
  }
  if (!accessToken || !user) {
    return (
      <Navigate to="/sign-in" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  return <Outlet />;
}

/** Shows a plain "no access" page instead of a screen whose every request would be 403. */
export function RequirePermission({ permission }: { permission: string }) {
  const { t } = useI18n();
  const allowed = useAuthStore((s) => s.user?.permissions.includes(permission) ?? false);

  if (!allowed) {
    return (
      <section className="page" aria-labelledby="forbidden-title">
        <h1 id="forbidden-title">{t('auth.forbidden.title')}</h1>
        <p className="muted">{t('auth.forbidden.body')}</p>
      </section>
    );
  }
  return <Outlet />;
}

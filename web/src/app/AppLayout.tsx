// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (web/src/app/AppLayout.tsx), see NOTICE.
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { DemoBanner } from '@/components/DemoBanner';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/useI18n';
import { ROLE_LABEL } from '@/lib/access';
import { useAuthStore } from '@/stores/auth.store';
import { visibleNav } from './navigation';

export function AppLayout() {
  const { t } = useI18n();
  const [navOpen, setNavOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sections = visibleNav(user?.permissions ?? []);

  const signOut = async () => {
    await logout();
    // Nothing the last person could see stays in memory for the next one.
    queryClient.clear();
    navigate('/sign-in', { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('shell.skipToContent')}
      </a>

      <DemoBanner />

      <header className="topbar">
        <button
          type="button"
          className="button button--ghost nav-toggle"
          aria-expanded={navOpen}
          aria-controls="primary-nav"
          onClick={() => setNavOpen((open) => !open)}
        >
          {navOpen ? t('shell.closeNavigation') : t('shell.openNavigation')}
        </button>
        <span className="brand">
          <img className="brand__logo" src="/favicon.svg" alt="" width={28} height={28} />
          <span>{t('app.name')}</span>
        </span>
        <span className="topbar__spacer" />
        <LanguageSwitcher />
      </header>

      <nav
        id="primary-nav"
        className={clsx('sidebar', navOpen && 'sidebar--open')}
        aria-label={t('shell.mainNavigation')}
      >
        {sections.map((section) => (
          <div key={section.id} className="sidebar__group">
            <span className="sidebar__heading" id={`nav-${section.id}`}>
              {t(section.headingKey)}
            </span>
            <ul aria-labelledby={`nav-${section.id}`}>
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setNavOpen(false)}
                    className={({ isActive }) => clsx('nav-link', isActive && 'nav-link--active')}
                  >
                    {t(item.labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {user && (
          <div className="session">
            <p className="session__label">{t('session.signedInAs')}</p>
            <p className="session__name">{user.displayName}</p>
            <p className="subtle session__email">{user.email}</p>
            {user.roles.length > 0 && (
              <p className="subtle">{user.roles.map((role) => t(ROLE_LABEL[role])).join(', ')}</p>
            )}
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void signOut()}
            >
              {t('session.signOut')}
            </button>
          </div>
        )}
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

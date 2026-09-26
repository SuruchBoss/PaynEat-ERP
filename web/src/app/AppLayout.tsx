// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (web/src/app/AppLayout.tsx), see NOTICE.
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { DemoBanner } from '@/components/DemoBanner';
import { Icon } from '@/components/Icon';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/useI18n';
import { ROLE_LABEL } from '@/lib/access';
import { useAuthStore } from '@/stores/auth.store';
import { locate, visibleNav } from './navigation';

/** Up to two letters for the account badge: first letters of the first two words. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase();
}

export function AppLayout() {
  const { t } = useI18n();
  const [navOpen, setNavOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sections = visibleNav(user?.permissions ?? []);
  const here = locate(useLocation().pathname, sections);

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
          <Icon name={navOpen ? 'close' : 'menu'} />
          <span className="nav-toggle__label">
            {navOpen ? t('shell.closeNavigation') : t('shell.openNavigation')}
          </span>
        </button>
        <span className="brand topbar__brand">
          <img className="brand__logo" src="/favicon.svg" alt="" width={28} height={28} />
          <span>{t('app.name')}</span>
        </span>
        {here && (
          <p className="topbar__trail">
            <span className="topbar__section">{t(here.section.headingKey)}</span>
            <span className="topbar__sep" aria-hidden="true">
              /
            </span>
            <span className="topbar__page">{t(here.item.labelKey)}</span>
          </p>
        )}
        <span className="topbar__spacer" />
        <LanguageSwitcher />
      </header>

      <nav
        id="primary-nav"
        className={clsx('sidebar', navOpen && 'sidebar--open')}
        aria-label={t('shell.mainNavigation')}
      >
        <span className="brand sidebar__brand">
          <img className="brand__logo" src="/favicon.svg" alt="" width={30} height={30} />
          <span>{t('app.name')}</span>
        </span>

        <div className="sidebar__groups">
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
                      // Named on hover where the rail shows only icons (a tablet).
                      title={t(item.labelKey)}
                      className={({ isActive }) => clsx('nav-link', isActive && 'nav-link--active')}
                    >
                      <Icon name={item.icon} />
                      <span>{t(item.labelKey)}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {user && (
          <div className="session">
            <span className="session__avatar" aria-hidden="true">
              {initials(user.displayName)}
            </span>
            <div className="session__who">
              <p className="visually-hidden">{t('session.signedInAs')}</p>
              <p className="session__name">{user.displayName}</p>
              {user.roles.length > 0 && (
                <p className="session__roles">
                  {user.roles.map((role) => t(ROLE_LABEL[role])).join(', ')}
                </p>
              )}
              <p className="session__email" title={user.email}>
                {user.email}
              </p>
            </div>
            <button
              type="button"
              className="button button--rail button--small session__signout"
              title={t('session.signOut')}
              onClick={() => void signOut()}
            >
              <Icon name="signOut" size={16} />
              <span>{t('session.signOut')}</span>
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

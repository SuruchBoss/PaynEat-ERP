// Adapted from Cwork (web/src/app/AppLayout.tsx), see NOTICE.
import clsx from 'clsx';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/useI18n';
import { NAV } from './navigation';

export function AppLayout() {
  const { t } = useI18n();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('shell.skipToContent')}
      </a>

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
        {NAV.map((section) => (
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
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

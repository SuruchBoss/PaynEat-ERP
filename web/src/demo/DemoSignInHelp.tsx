// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The sign-in help of the public demo (#41): the demo accounts, their shared password and the
 * administrator's second-factor codes, all published in README already. Only the demo build
 * loads this; a visitor should not need README open to get in.
 */
import { useI18n } from '@/i18n/useI18n';
import { ROLE_LABEL } from '@/lib/access';
import { DEMO_MFA_SECRET, DEMO_PASSWORD, DEMO_RECOVERY_CODES, DEMO_USERS } from './seed';

export interface DemoSignInHelpProps {
  /** The password step lists the accounts; the code step lists the second-factor codes. */
  step: 'password' | 'code';
  onPick: (email: string, password: string) => void;
}

export default function DemoSignInHelp({ step, onPick }: DemoSignInHelpProps) {
  const { t } = useI18n();

  if (step === 'code') {
    return (
      <aside className="demo-help" aria-labelledby="demo-help-title">
        <h2 id="demo-help-title">{t('demo.secondFactor.title')}</h2>
        <p className="subtle">{t('demo.secondFactor.body')}</p>
        <ul className="recovery-codes" aria-label={t('demo.secondFactor.codes')}>
          {DEMO_RECOVERY_CODES.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <p className="subtle">
          {t('demo.secondFactor.secret')} <code className="secret">{DEMO_MFA_SECRET}</code>
        </p>
      </aside>
    );
  }

  return (
    <aside className="demo-help" aria-labelledby="demo-help-title">
      <h2 id="demo-help-title">{t('demo.accounts.title')}</h2>
      <p className="subtle">
        {t('demo.accounts.intro')} <code>{DEMO_PASSWORD}</code>
      </p>
      <ul className="demo-help__accounts">
        {DEMO_USERS.map((user) => (
          <li key={user.email}>
            <button
              type="button"
              className="button button--ghost button--small"
              aria-describedby={`demo-account-${user.role}`}
              onClick={() => onPick(user.email, DEMO_PASSWORD)}
            >
              {t(ROLE_LABEL[user.role])}
            </button>
            <span id={`demo-account-${user.role}`} className="subtle">
              {user.email}
            </span>
          </li>
        ))}
      </ul>
      <p className="subtle">{t('demo.accounts.admin')}</p>
    </aside>
  );
}

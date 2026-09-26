// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (web/src/features/auth/LoginPage.tsx), see NOTICE: the same steps —
// password, then a code or, for an account that must have a second factor and has none,
// enrolment and recovery codes — without Cwork's device fields.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { ErrorCallout } from '@/components/ErrorCallout';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import type { MessageKey } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { useAuthStore } from '@/stores/auth.store';
import type { LoginSession, MfaEnrolmentOffer } from './auth.types';

type Step =
  | { kind: 'password' }
  | { kind: 'code'; challengeToken: string }
  | { kind: 'enrol'; challengeToken: string; offer: MfaEnrolmentOffer; qr: string }
  | { kind: 'recovery'; recoveryCodes: string[]; session: LoginSession };

const PASSWORD_ERRORS: Record<string, MessageKey> = {
  INVALID_CREDENTIALS: 'signIn.error.credentials',
  ACCOUNT_LOCKED: 'signIn.error.locked',
  ACCOUNT_DISABLED: 'signIn.error.disabled',
  VALIDATION_FAILED: 'signIn.error.credentials',
};

const CODE_ERRORS: Record<string, MessageKey> = {
  SECOND_FACTOR_REJECTED: 'signIn.error.code',
  MFA_CODE_INVALID: 'signIn.error.code',
  SIGN_IN_EXPIRED: 'signIn.error.expired',
  ACCOUNT_LOCKED: 'signIn.error.locked',
  ACCOUNT_DISABLED: 'signIn.error.disabled',
};

/** The otpauth URI as an SVG data URL: no canvas, nothing loaded from elsewhere (CSP). */
async function qrImage(uri: string): Promise<string> {
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function SignInPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const signedIn = useAuthStore((s) => Boolean(s.accessToken && s.user));
  const { login, verifyMfa, beginEnrolment, activateEnrolment, adoptSession } = useAuthStore();

  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  // Each step is a new screen for a screen reader: announce it by moving focus.
  useEffect(() => {
    if (step.kind !== 'password') headingRef.current?.focus();
  }, [step.kind]);

  if (signedIn && step.kind !== 'recovery') return <Navigate to={from} replace />;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    // The password leaves the form as soon as it is sent, whatever the answer.
    const typed = password;
    setPassword('');
    void run(async () => {
      const challenge = await login(email.trim(), typed);
      if (!challenge) {
        navigate(from, { replace: true });
      } else if (challenge.mfaEnrolled) {
        setStep({ kind: 'code', challengeToken: challenge.challengeToken });
      } else {
        const offer = await beginEnrolment(challenge.challengeToken);
        setStep({
          kind: 'enrol',
          challengeToken: challenge.challengeToken,
          offer,
          qr: await qrImage(offer.otpauthUri),
        });
      }
    });
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (step.kind === 'code') {
      void run(async () => {
        await verifyMfa(step.challengeToken, code.trim());
        navigate(from, { replace: true });
      });
    } else if (step.kind === 'enrol') {
      void run(async () => {
        const activation = await activateEnrolment(step.challengeToken, code.trim());
        setCode('');
        if (activation.session) {
          setStep({
            kind: 'recovery',
            recoveryCodes: activation.recoveryCodes,
            session: activation.session,
          });
        }
      });
    }
  };

  const startOver = () => {
    setStep({ kind: 'password' });
    setCode('');
    setError(null);
  };

  const finish = () => {
    if (step.kind !== 'recovery') return;
    adoptSession(step.session);
    navigate(from, { replace: true });
  };

  const titleKey: Record<Step['kind'], MessageKey> = {
    password: 'signIn.title',
    code: 'signIn.code.title',
    enrol: 'signIn.enrol.title',
    recovery: 'signIn.recovery.title',
  };

  return (
    <div className="auth-screen">
      <header className="auth-screen__top">
        <span className="brand">
          <img className="brand__logo" src="/favicon.svg" alt="" width={28} height={28} />
          <span>{t('app.name')}</span>
        </span>
        <LanguageSwitcher />
      </header>

      <main id="main" className="auth-card" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title" ref={headingRef} tabIndex={-1}>
          {t(titleKey[step.kind])}
        </h1>

        {step.kind === 'password' && (
          <form onSubmit={submitPassword}>
            <p className="muted">{t('signIn.intro')}</p>
            <div className="field">
              <label htmlFor="sign-in-email">{t('signIn.email')}</label>
              <input
                id="sign-in-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="sign-in-password">{t('signIn.password')}</label>
              <input
                id="sign-in-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error !== null && <ErrorCallout error={error} messages={PASSWORD_ERRORS} />}
            <button type="submit" className="button button--block" disabled={busy}>
              {busy ? t('signIn.working') : t('signIn.submit')}
            </button>
          </form>
        )}

        {(step.kind === 'code' || step.kind === 'enrol') && (
          <form onSubmit={submitCode}>
            {step.kind === 'code' ? (
              <p className="muted">{t('signIn.code.intro')}</p>
            ) : (
              <>
                <p className="muted">{t('signIn.enrol.intro')}</p>
                <ol className="steps">
                  <li>{t('signIn.enrol.stepScan')}</li>
                  <li>{t('signIn.enrol.stepCode')}</li>
                </ol>
                <img
                  className="qr"
                  src={step.qr}
                  width={200}
                  height={200}
                  alt={t('signIn.enrol.qrAlt')}
                />
                <p className="subtle">
                  {t('signIn.enrol.manual')} <code className="secret">{step.offer.secret}</code>
                </p>
              </>
            )}
            <div className="field">
              <label htmlFor="sign-in-code">{t('signIn.code.label')}</label>
              <input
                id="sign-in-code"
                type="text"
                inputMode={step.kind === 'enrol' ? 'numeric' : 'text'}
                autoComplete="one-time-code"
                required
                aria-describedby="sign-in-code-hint"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <p id="sign-in-code-hint" className="subtle">
                {step.kind === 'code' ? t('signIn.code.hint') : t('signIn.enrol.codeHint')}
              </p>
            </div>
            {error !== null && <ErrorCallout error={error} messages={CODE_ERRORS} />}
            <div className="actions">
              <button type="submit" className="button" disabled={busy}>
                {busy
                  ? t('signIn.working')
                  : step.kind === 'code'
                    ? t('signIn.code.submit')
                    : t('signIn.enrol.submit')}
              </button>
              <button type="button" className="button button--ghost" onClick={startOver}>
                {t('signIn.startOver')}
              </button>
            </div>
          </form>
        )}

        {step.kind === 'recovery' && (
          <>
            <p className="muted">{t('signIn.recovery.intro')}</p>
            <ul className="recovery-codes" aria-label={t('signIn.recovery.listLabel')}>
              {step.recoveryCodes.map((recoveryCode) => (
                <li key={recoveryCode}>
                  <code>{recoveryCode}</code>
                </li>
              ))}
            </ul>
            <p className="callout">{t('signIn.recovery.warning')}</p>
            <button type="button" className="button button--block" onClick={finish}>
              {t('signIn.recovery.continue')}
            </button>
          </>
        )}
      </main>
    </div>
  );
}

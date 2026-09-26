// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The demo-installation rules of #5, decided by the product owner: one opt-in flag,
 * `ERP_DEMO=1`, for both the demo seed and the API, because the seed's accounts have a
 * published password and a published second-factor secret. Pure, so the seed, the API's
 * start-up and sign-in share one definition.
 */

/** The documented way out of a refused start: users are never deleted, only disabled. */
export const DISABLE_DEMO_COMMAND = 'npm run demo:disable';
export const DISABLE_DEMO_COMPOSE_COMMAND = 'docker compose run --rm migrate npm run demo:disable';

export interface SeedEnvironment {
  erpDemo: string | undefined;
  nodeEnv: string | undefined;
}

/** Why the demo seed must not run here, or null when it may. */
export function seedRefusal({ erpDemo, nodeEnv }: SeedEnvironment): string | null {
  if (nodeEnv === 'production') {
    return (
      'NODE_ENV is production. The demo seed creates accounts with published passwords and ' +
      'never runs against a production configuration.'
    );
  }
  if (erpDemo !== '1') {
    return (
      'ERP_DEMO is not 1. The demo seed creates accounts with published passwords, so it runs ' +
      'only when this is explicitly an evaluation installation: set ERP_DEMO=1 and run it again.'
    );
  }
  return null;
}

export interface StartSituation {
  production: boolean;
  demoFlag: boolean;
  /** Demo accounts (by the seed's marker) whose status is still ACTIVE. */
  enabledDemoAccounts: number;
}

export type StartDecision =
  | { kind: 'start' }
  | { kind: 'start-as-demo'; warning: string }
  | { kind: 'refuse'; critical: string };

/**
 * What a starting API does about demo accounts. Only production is guarded: development
 * and the test suite seed demo data on purpose.
 */
export function startDecision({
  production,
  demoFlag,
  enabledDemoAccounts,
}: StartSituation): StartDecision {
  if (!production) return { kind: 'start' };
  if (demoFlag) {
    return {
      kind: 'start-as-demo',
      warning:
        'Demo installation (ERP_DEMO=1): the demo accounts sign in with published passwords. ' +
        'Never put real data here.',
    };
  }
  if (enabledDemoAccounts > 0) {
    const accounts =
      enabledDemoAccounts === 1 ? '1 demo account' : `${enabledDemoAccounts} demo accounts`;
    return {
      kind: 'refuse',
      critical:
        `Refusing to start: ${accounts} with a published password ${enabledDemoAccounts === 1 ? 'is' : 'are'} enabled. ` +
        `Disable them with \`${DISABLE_DEMO_COMPOSE_COMMAND}\` (or \`${DISABLE_DEMO_COMMAND}\` in backend/), ` +
        'or set ERP_DEMO=1 if this really is an evaluation.',
    };
  }
  return { kind: 'start' };
}

/** A demo account signs in only on a demo installation. */
export function demoSignInAllowed(isDemoAccount: boolean, demoFlag: boolean): boolean {
  return !isDemoAccount || demoFlag;
}

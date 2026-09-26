// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { demoSignInAllowed, seedRefusal, startDecision } from './demo-mode';

describe('demo mode (#5)', () => {
  describe('seedRefusal', () => {
    it('lets the seed run only with ERP_DEMO=1 outside production', () => {
      expect(seedRefusal({ erpDemo: '1', nodeEnv: 'development' })).toBeNull();
      expect(seedRefusal({ erpDemo: '1', nodeEnv: 'test' })).toBeNull();
      expect(seedRefusal({ erpDemo: '1', nodeEnv: undefined })).toBeNull();
    });

    it('refuses without the flag, and names the flag', () => {
      for (const erpDemo of [undefined, '', '0', 'true', 'yes']) {
        expect(seedRefusal({ erpDemo, nodeEnv: 'development' })).toMatch(/ERP_DEMO=1/);
      }
    });

    it('refuses under NODE_ENV=production even with the flag', () => {
      expect(seedRefusal({ erpDemo: '1', nodeEnv: 'production' })).toMatch(
        /NODE_ENV is production/,
      );
    });
  });

  describe('startDecision', () => {
    it('never interferes outside production', () => {
      expect(startDecision({ production: false, demoFlag: false, enabledDemoAccounts: 7 })).toEqual(
        {
          kind: 'start',
        },
      );
    });

    it('refuses a production start while demo accounts are enabled, saying how to fix it', () => {
      const decision = startDecision({ production: true, demoFlag: false, enabledDemoAccounts: 7 });
      expect(decision.kind).toBe('refuse');
      const critical = decision.kind === 'refuse' ? decision.critical : '';
      expect(critical).toContain('7 demo accounts');
      expect(critical).toContain('docker compose run --rm migrate npm run demo:disable');
      expect(critical).toContain('ERP_DEMO=1');
      expect(critical).not.toContain('\n');
    });

    it('starts in production once every demo account is disabled', () => {
      expect(startDecision({ production: true, demoFlag: false, enabledDemoAccounts: 0 })).toEqual({
        kind: 'start',
      });
    });

    it('starts as a demo, with a warning, when ERP_DEMO=1', () => {
      const decision = startDecision({ production: true, demoFlag: true, enabledDemoAccounts: 7 });
      expect(decision.kind).toBe('start-as-demo');
    });
  });

  it('lets demo accounts sign in only on a demo installation', () => {
    expect(demoSignInAllowed(true, true)).toBe(true);
    expect(demoSignInAllowed(true, false)).toBe(false);
    expect(demoSignInAllowed(false, false)).toBe(true);
  });
});

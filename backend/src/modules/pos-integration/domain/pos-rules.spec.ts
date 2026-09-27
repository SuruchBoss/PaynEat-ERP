// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  bearerToken,
  canonicalJson,
  looksLikeCredential,
  registrationProblem,
  salesEventRefusal,
} from './pos-rules';

describe('POS integration rules', () => {
  describe('registration', () => {
    const valid = { code: 'POS-SILOM-1', name: 'Silom counter', branchCodes: ['BR-SILOM'] };

    it('accepts a code in the ecosystem shape, a name, and at least one distinct branch', () => {
      expect(registrationProblem(valid)).toBeNull();
      expect(registrationProblem({ ...valid, branchCodes: ['BR-SILOM', 'BR-ARI'] })).toBeNull();
    });

    it.each([
      [{ code: 'pos-silom' }, 'CODE_INVALID'],
      [{ code: 'P' }, 'CODE_INVALID'],
      [{ code: 'POS SILOM' }, 'CODE_INVALID'],
      [{ name: '   ' }, 'NAME_MISSING'],
      [{ name: 'x'.repeat(101) }, 'NAME_TOO_LONG'],
      [{ branchCodes: [] }, 'NO_BRANCHES'],
      [{ branchCodes: ['BR-SILOM', 'BR-SILOM'] }, 'DUPLICATE_BRANCH'],
    ])('refuses %j with %s', (change, problem) => {
      expect(registrationProblem({ ...valid, ...change })).toBe(problem);
    });
  });

  describe('credentials', () => {
    it('recognises the machine-credential shape, and reads a bearer header', () => {
      const token = `pnepos_${'A'.repeat(43)}`;
      expect(looksLikeCredential(token)).toBe(true);
      expect(looksLikeCredential(`pnepos_${'A'.repeat(42)}`)).toBe(false);
      expect(looksLikeCredential('eyJhbGciOiJIUzI1NiJ9.x.y')).toBe(false);
      expect(bearerToken(`Bearer ${token}`)).toBe(token);
      expect(bearerToken(`bearer ${token}`)).toBeNull();
      expect(bearerToken(undefined)).toBeNull();
      expect(bearerToken('Basic abc')).toBeNull();
    });
  });

  describe('a sales event that matches the schema', () => {
    const instance = { code: 'POS-SILOM-1', branchCodes: ['BR-SILOM', 'BR-ARI'] };

    it('is accepted for the instance itself and a branch it serves', () => {
      expect(
        salesEventRefusal({ posInstance: 'POS-SILOM-1', branchCode: 'BR-ARI' }, instance),
      ).toBe(null);
    });

    it('is refused when it names another instance, or a branch the instance does not serve', () => {
      expect(salesEventRefusal({ posInstance: 'POS-ARI-1', branchCode: 'BR-ARI' }, instance)).toBe(
        'pos_instance_mismatch',
      );
      expect(
        salesEventRefusal({ posInstance: 'POS-SILOM-1', branchCode: 'BR-ASOK' }, instance),
      ).toBe('branch_not_served');
    });
  });

  describe('canonical JSON', () => {
    it('is the same text whatever the order of keys, at every depth', () => {
      const a = { b: 1, a: [{ y: '2', x: null }], c: 'ไก่' };
      const b = { c: 'ไก่', a: [{ x: null, y: '2' }], b: 1 };
      expect(canonicalJson(a)).toBe(canonicalJson(b));
      expect(canonicalJson(a)).toBe('{"a":[{"x":null,"y":"2"}],"b":1,"c":"ไก่"}');
      expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
    });
  });
});

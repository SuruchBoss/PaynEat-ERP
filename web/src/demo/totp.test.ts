// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// The one rule the demo cannot import (the backend's signs with Node's crypto) is checked
// against it here, where tests run on Node (ADR-0021).
import { describe, expect, it } from 'vitest';
import {
  base32Encode as backendBase32Encode,
  generateTotpForStep,
  verifyTotp,
} from '@backend/src/modules/auth/domain/totp';
import { DEMO_MFA_SECRET } from './seed';
import { acceptedStep, base32Encode, hotp, normaliseRecoveryCode } from './totp';

/** RFC 6238 appendix B, SHA-1: the key "12345678901234567890", codes cut to six digits. */
const RFC_SECRET = backendBase32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: Array<[seconds: number, code: string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('demo second factor (#41)', () => {
  it('computes the RFC 6238 test vectors', async () => {
    for (const [seconds, code] of RFC_VECTORS) {
      expect(await hotp(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
    }
  });

  it('gives the codes the backend gives for the demo secret', async () => {
    for (let step = 59_000_000; step < 59_000_020; step += 1) {
      expect(await hotp(DEMO_MFA_SECRET, step)).toBe(generateTotpForStep(DEMO_MFA_SECRET, step));
    }
  });

  it('accepts and refuses exactly what backend verifyTotp does', async () => {
    const atMs = Date.UTC(2026, 8, 26, 3, 0, 0);
    const step = Math.floor(atMs / 30_000);
    const code = (s: number) => generateTotpForStep(DEMO_MFA_SECRET, s);
    const cases: Array<{ code: string; lastUsedStep: number | null }> = [
      { code: code(step), lastUsedStep: null },
      { code: code(step - 1), lastUsedStep: null },
      { code: code(step + 1), lastUsedStep: null },
      { code: code(step - 2), lastUsedStep: null },
      { code: code(step + 2), lastUsedStep: null },
      { code: code(step), lastUsedStep: step },
      { code: code(step + 1), lastUsedStep: step },
      { code: ` ${code(step)} `, lastUsedStep: null },
      { code: '12345', lastUsedStep: null },
      { code: 'abcdef', lastUsedStep: null },
    ];
    for (const input of cases) {
      const backend = verifyTotp({ secretBase32: DEMO_MFA_SECRET, atMs, ...input });
      const demo = await acceptedStep(DEMO_MFA_SECRET, input.code, atMs, input.lastUsedStep);
      expect({ input, step: demo }).toEqual({ input, step: backend.valid ? backend.step : null });
    }
  });

  it('spells base32 and recovery codes the way the backend does', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 7, 99]);
    expect(base32Encode(bytes)).toBe(backendBase32Encode(Buffer.from(bytes)));
    expect(normaliseRecoveryCode('democ-hicke nrcvr-yaaa2')).toBe('DEMOCHICKENRCVRYAAA2');
  });
});

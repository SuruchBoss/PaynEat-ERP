// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Copied from Cwork (backend/src/modules/auth/domain/totp.spec.ts), see NOTICE; only the
// example issuer and account names are the ERP's own.
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  constantTimeEquals,
  generateRecoveryCodes,
  generateTotpForStep,
  generateTotpSecret,
  normaliseRecoveryCode,
  timeStepAt,
  verifyTotp,
} from './totp';

/**
 * RFC 6238 Appendix B publishes the seed "12345678901234567890" with the
 * expected 8-digit codes at six instants. If this implementation agrees with
 * the RFC it will agree with Google Authenticator, 1Password and the rest.
 */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const original = Buffer.from([0x00, 0xff, 0x10, 0x7a, 0x99, 0x42, 0x01]);

    expect(base32Decode(base32Encode(original)).equals(original)).toBe(true);
  });

  it('matches the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Encode(Buffer.from('fo'))).toBe('MZXQ');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('ignores padding, whitespace and case when decoding', () => {
    expect(base32Decode('mzxw 6ytb oi===').toString()).toBe('foobar');
  });

  it('rejects a character outside the alphabet', () => {
    // '1' and '0' are excluded precisely because they are misread.
    expect(() => base32Decode('MZXW6YTB01')).toThrow(/Invalid base32/);
  });
});

describe('generateTotpForStep — RFC 6238 test vectors', () => {
  const vectors: [seconds: number, expected: string][] = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ];

  it.each(vectors)('at T=%i produces %s', (seconds, expected) => {
    const step = timeStepAt(seconds * 1000);

    expect(generateTotpForStep(RFC_SECRET, step, { digits: 8 })).toBe(expected);
  });

  it('produces the six digits authenticator apps actually show', () => {
    const code = generateTotpForStep(RFC_SECRET, timeStepAt(59_000));

    expect(code).toBe('287082');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('pads a short code rather than dropping the leading zero', () => {
    // A code is a string, not a number: 0-prefixed codes are common and losing
    // that zero locks people out about one time in ten.
    const codes = Array.from({ length: 500 }, (_, i) =>
      generateTotpForStep(RFC_SECRET, 10_000 + i),
    );

    expect(codes.every((c) => c.length === 6)).toBe(true);
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
  });
});

describe('verifyTotp', () => {
  const now = 1_700_000_000_000;
  const currentStep = timeStepAt(now);
  const validCode = generateTotpForStep(RFC_SECRET, currentStep);

  it('accepts the current code', () => {
    const result = verifyTotp({ secretBase32: RFC_SECRET, code: validCode, atMs: now });

    expect(result).toEqual({ valid: true, step: currentStep, reason: 'ok' });
  });

  it('tolerates one step of clock drift either side', () => {
    for (const drift of [-1, 1]) {
      const code = generateTotpForStep(RFC_SECRET, currentStep + drift);
      const result = verifyTotp({ secretBase32: RFC_SECRET, code, atMs: now });

      expect(result.valid).toBe(true);
      expect(result.step).toBe(currentStep + drift);
    }
  });

  it('refuses a code two steps out', () => {
    const stale = generateTotpForStep(RFC_SECRET, currentStep - 2);

    expect(verifyTotp({ secretBase32: RFC_SECRET, code: stale, atMs: now }).reason).toBe(
      'mismatch',
    );
  });

  it('refuses a code already spent, even while it is still in window', () => {
    // The whole point: a code observed by a phishing proxy must not work twice.
    const result = verifyTotp({
      secretBase32: RFC_SECRET,
      code: validCode,
      atMs: now,
      lastUsedStep: currentStep,
    });

    expect(result).toEqual({ valid: false, step: currentStep, reason: 'replayed' });
  });

  it('refuses a code from before the last one spent', () => {
    const older = generateTotpForStep(RFC_SECRET, currentStep - 1);

    const result = verifyTotp({
      secretBase32: RFC_SECRET,
      code: older,
      atMs: now,
      lastUsedStep: currentStep,
    });

    expect(result.reason).toBe('replayed');
  });

  it('still accepts the next step after one is spent', () => {
    const next = generateTotpForStep(RFC_SECRET, currentStep + 1);

    const result = verifyTotp({
      secretBase32: RFC_SECRET,
      code: next,
      atMs: now,
      lastUsedStep: currentStep,
    });

    expect(result.valid).toBe(true);
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 34 56 78'])(
    'rejects %p as malformed before doing any crypto',
    (code) => {
      expect(verifyTotp({ secretBase32: RFC_SECRET, code, atMs: now }).reason).toBe('malformed');
    },
  );

  it('accepts a code typed with spaces, which is how apps display it', () => {
    const spaced = `${validCode.slice(0, 3)} ${validCode.slice(3)}`;

    expect(verifyTotp({ secretBase32: RFC_SECRET, code: spaced, atMs: now }).valid).toBe(true);
  });

  it('rejects a valid-shaped code for a different secret', () => {
    const otherSecret = generateTotpSecret();
    const code = generateTotpForStep(otherSecret, currentStep);

    // Astronomically unlikely to collide, but assert on the secret we control.
    expect(verifyTotp({ secretBase32: RFC_SECRET, code, atMs: now }).valid).toBe(
      code === validCode,
    );
  });
});

describe('buildOtpauthUri', () => {
  it('produces a URI an authenticator app can scan', () => {
    const uri = buildOtpauthUri({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      accountName: 'admin@demo-chicken.example',
      issuer: 'PaynEat ERP',
    });

    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=PaynEat+ERP');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('escapes a label that contains a colon or a space', () => {
    const uri = buildOtpauthUri({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      accountName: 'someone@example.com',
      issuer: 'บริษัท เพย์นอีท เดโม ไก่ทอด จำกัด (สมมติ)',
    });

    const label = uri.slice('otpauth://totp/'.length, uri.indexOf('?'));
    // A raw colon or space in the label breaks parsing in several apps.
    expect(label).not.toContain(' ');
    expect(decodeURIComponent(label)).toBe(
      'บริษัท เพย์นอีท เดโม ไก่ทอด จำกัด (สมมติ):someone@example.com',
    );
  });
});

describe('recovery codes', () => {
  it('issues ten distinct codes', () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it('formats them in readable blocks', () => {
    for (const code of generateRecoveryCodes(3)) {
      expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}-[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    }
  });

  it('normalises however the user types them back', () => {
    const [code] = generateRecoveryCodes(1);
    const mangled = code.toLowerCase().replace(/-/g, ' ');

    expect(normaliseRecoveryCode(mangled)).toBe(normaliseRecoveryCode(code));
  });
});

describe('constantTimeEquals', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEquals('123456', '123456')).toBe(true);
    expect(constantTimeEquals('123456', '123457')).toBe(false);
  });

  it('is false for different lengths without throwing', () => {
    expect(constantTimeEquals('123456', '1234567')).toBe(false);
  });
});

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), and the base32 alphabet authenticator
 * apps expect (RFC 4648, unpadded).
 *
 * Implemented here rather than pulled in as a dependency: it is ~80 lines of
 * well-specified arithmetic over `node:crypto`, it is a pure function of its
 * inputs, and it is verified below against the RFC's own test vectors. A second
 * factor whose correctness rests on an unmaintained package is not much of a
 * second factor.
 *
 * No I/O, no clock of its own — the caller passes the time (ADR-0010: business rules
 * are pure functions in `domain/`).
 *
 * Copied from Cwork (backend/src/modules/auth/domain/totp.ts) unchanged apart from
 * this comment, see NOTICE.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_DEFAULTS = {
  /** Seconds per step. 30 is what every authenticator app assumes. */
  stepSeconds: 30,
  digits: 6,
  /**
   * Steps of clock skew tolerated either side of the current one. 1 means a
   * code stays usable for at most 90 seconds, which covers a phone whose clock
   * has drifted without widening the window enough to matter.
   */
  window: 1,
  algorithm: 'sha1' as const,
};

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh secret. 20 bytes is the RFC 4226 recommendation for HMAC-SHA1. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** The step number a given instant falls in. Also what replay checks compare. */
export function timeStepAt(atMs: number, stepSeconds = TOTP_DEFAULTS.stepSeconds): number {
  return Math.floor(atMs / 1000 / stepSeconds);
}

export interface TotpOptions {
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

/** HOTP for an explicit counter — the primitive TOTP is built from. */
export function generateHotp(secret: Buffer, counter: number, options: TotpOptions = {}): string {
  const digits = options.digits ?? TOTP_DEFAULTS.digits;
  const algorithm = options.algorithm ?? TOTP_DEFAULTS.algorithm;

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(algorithm, secret).update(counterBuffer).digest();

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The code for a base32 secret at a given step. */
export function generateTotpForStep(
  secretBase32: string,
  step: number,
  options: TotpOptions = {},
): string {
  return generateHotp(base32Decode(secretBase32), step, options);
}

export interface VerifyTotpInput {
  secretBase32: string;
  code: string;
  /** Milliseconds since the epoch — passed in, never read from the clock here. */
  atMs: number;
  stepSeconds?: number;
  window?: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
  /**
   * The newest step already spent by this user. A code is a bearer secret for
   * its whole window, so accepting the same step twice would let anyone who
   * observed it — a phishing proxy, a shoulder surfer — reuse it.
   */
  lastUsedStep?: number | null;
}

export interface VerifyTotpResult {
  valid: boolean;
  /** The step the code matched, to be recorded against the user. */
  step: number | null;
  reason: 'ok' | 'malformed' | 'mismatch' | 'replayed';
}

export function verifyTotp(input: VerifyTotpInput): VerifyTotpResult {
  const digits = input.digits ?? TOTP_DEFAULTS.digits;
  const window = input.window ?? TOTP_DEFAULTS.window;
  const stepSeconds = input.stepSeconds ?? TOTP_DEFAULTS.stepSeconds;

  const candidate = input.code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) {
    return { valid: false, step: null, reason: 'malformed' };
  }

  const current = timeStepAt(input.atMs, stepSeconds);

  for (let drift = -window; drift <= window; drift += 1) {
    const step = current + drift;
    const expected = generateTotpForStep(input.secretBase32, step, {
      digits,
      algorithm: input.algorithm,
    });
    if (!constantTimeEquals(expected, candidate)) continue;

    if (input.lastUsedStep != null && step <= input.lastUsedStep) {
      return { valid: false, step, reason: 'replayed' };
    }
    return { valid: true, step, reason: 'ok' };
  }

  return { valid: false, step: null, reason: 'mismatch' };
}

/** Equal-length comparison that does not leak where two codes diverge. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface OtpauthUriInput {
  secretBase32: string;
  /** Shown under the issuer in the app — the user's email works well. */
  accountName: string;
  /** The company, so someone with several accounts can tell them apart. */
  issuer: string;
  digits?: number;
  stepSeconds?: number;
}

/** The `otpauth://` URI an authenticator app scans. */
export function buildOtpauthUri(input: OtpauthUriInput): string {
  const label = `${input.issuer}:${input.accountName}`;
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(input.digits ?? TOTP_DEFAULTS.digits),
    period: String(input.stepSeconds ?? TOTP_DEFAULTS.stepSeconds),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Recovery codes: what gets someone back in when their phone is gone.
 *
 * 20 base32 characters is 100 bits of entropy, so these are not guessable and
 * do not need a slow KDF — they are stored as SHA-256 digests, the same
 * treatment refresh tokens get. Grouping into blocks is purely so they can be
 * read off a printout without losing your place.
 */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(13)).slice(0, 20);
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
  });
}

/** Recovery codes are compared without their separators or case. */
export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Second-factor codes in the public demo (#41, ADR-0021). The backend's
 * `modules/auth/domain/totp.ts` is the rule, but it signs with Node's crypto, which a browser
 * does not have. This is the same RFC 6238 computation on the browser's Web Crypto, with the
 * same window (one step either side) and the same refusal of a step already used;
 * `totp.test.ts` checks it against the backend function and against the RFC's own vectors.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

/** RFC 4226 HOTP, six digits, HMAC-SHA1. */
export async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const message = new DataView(new ArrayBuffer(8));
  message.setBigUint64(0, BigInt(counter));
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message.buffer));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export const timeStep = (atMs: number): number => Math.floor(atMs / 30_000);

/**
 * The step a code belongs to, within one step either side of now, or null: a malformed code,
 * no match, or a match on a step already used (a replay), as backend `verifyTotp` decides.
 */
export async function acceptedStep(
  secret: string,
  code: string,
  atMs: number,
  lastUsedStep: number | null,
): Promise<number | null> {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;
  const now = timeStep(atMs);
  for (let drift = -1; drift <= 1; drift += 1) {
    const step = now + drift;
    if ((await hotp(secret, step)) !== candidate) continue;
    return lastUsedStep !== null && step <= lastUsedStep ? null : step;
  }
  return null;
}

/** Recovery codes are compared without separators or case (backend `normaliseRecoveryCode`). */
export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

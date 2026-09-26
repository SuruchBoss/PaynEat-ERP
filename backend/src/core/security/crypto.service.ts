// Adapted from Cwork (backend/src/core/security/crypto.service.ts), see NOTICE.
import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { APP_CONFIG } from '../config/config.token';
import type { RootConfig } from '../config/configuration';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

/**
 * All cryptography the application performs, in one auditable place.
 *
 * Encrypted columns use AES-256-GCM with a random IV per value and store
 * `v1:<iv>:<tag>:<ciphertext>` (base64 parts). The version prefix means a future
 * key rotation can decrypt old values while writing new ones. The demo seed writes
 * the same format (prisma/seed.ts).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: RootConfig) {
    const key = Buffer.from(config.security.fieldEncryptionKey, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException(
        'FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)',
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string | null | undefined): string | null {
    if (!payload) return null;
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new InternalServerErrorException('Encrypted value has an unrecognised format');
    }
    const [, ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new InternalServerErrorException('Encrypted value has an invalid IV or auth tag');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1). */
  async hashPassword(password: string): Promise<string> {
    return argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  async verifyPassword(hashed: string, password: string): Promise<boolean> {
    try {
      return await argonVerify(hashed, password);
    } catch {
      // A malformed stored hash must read as "wrong password", never as a crash.
      return false;
    }
  }

  /** For opaque tokens (refresh tokens, recovery codes) stored at rest. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Constant-time compare for secrets that arrive from the client. */
  safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}

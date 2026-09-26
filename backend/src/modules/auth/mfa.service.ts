// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/modules/auth/mfa.service.ts), see NOTICE. The ERP has
// one company, so Cwork's organisation-wide "require MFA for everyone" switch is gone:
// an account needs a second factor when its roles demand one (ADR-0008 admin). Disabling
// the second factor and regenerating recovery codes are not in #4.
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { BusinessRuleError } from '../../core/errors/domain.errors';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/security/crypto.service';
import { requiresSecondFactor } from '../../core/security/permissions';
import { AuditService } from '../audit/audit.service';
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  normaliseRecoveryCode,
  verifyTotp,
} from './domain/totp';
import type { MfaEnrolmentOffer, MfaRecoveryCodes, MfaStatus } from './dto/auth.dto';
import type { ClientMeta } from './session-tokens.service';

/** Shown in authenticator apps above the account name. */
export const TOTP_ISSUER = 'PaynEat ERP';

export type FactorOutcome = 'accepted' | 'replayed' | 'rejected';

export interface MfaRequirement {
  /** True when this account may not hold a session without a second factor. */
  required: boolean;
  /** True once a secret has been activated. */
  enrolled: boolean;
}

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /** Whether this account needs a second factor, and whether it has one. */
  async requirementFor(userId: string): Promise<MfaRequirement> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, roles: { select: { role: true } } },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return {
      required: requiresSecondFactor(user.roles.map((r) => r.role)),
      enrolled: user.mfaEnabled,
    };
  }

  async statusFor(userId: string): Promise<MfaStatus> {
    const [requirement, user] = await Promise.all([
      this.requirementFor(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { mfaEnrolledAt: true, mfaRecoveryCodes: true },
      }),
    ]);
    return {
      ...requirement,
      enrolledAt: user.mfaEnrolledAt?.toISOString() ?? null,
      recoveryCodesRemaining: user.mfaRecoveryCodes.length,
    };
  }

  /**
   * Starts enrolment: a fresh secret, stored encrypted but **not** yet active.
   *
   * Returned in the clear exactly once, because the user has to type or scan it into an
   * authenticator app. It becomes a second factor only when `activate` proves they can
   * produce a code from it. (Cwork.)
   */
  async beginEnrolment(userId: string): Promise<MfaEnrolmentOffer> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, mfaEnabled: true },
    });
    if (user.mfaEnabled) {
      throw new BusinessRuleError(
        'MFA_ALREADY_ENROLLED',
        'Two-factor authentication is already set up for this account.',
      );
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEnc: this.crypto.encrypt(secret), mfaLastUsedStep: null },
    });

    return {
      secret,
      otpauthUri: buildOtpauthUri({
        secretBase32: secret,
        accountName: user.email,
        issuer: TOTP_ISSUER,
      }),
    };
  }

  /**
   * Activates the pending secret once the user proves they hold it, and issues the
   * recovery codes — returned here and never again: only their digests are kept.
   */
  async activate(userId: string, code: string, meta: ClientMeta): Promise<MfaRecoveryCodes> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecretEnc: true, mfaLastUsedStep: true },
    });
    if (user.mfaEnabled) {
      throw new BusinessRuleError(
        'MFA_ALREADY_ENROLLED',
        'Two-factor authentication is already on.',
      );
    }
    const secret = this.crypto.decrypt(user.mfaSecretEnc);
    if (!secret) {
      throw new BusinessRuleError('MFA_NOT_STARTED', 'Start enrolment before confirming a code.');
    }

    const result = verifyTotp({
      secretBase32: secret,
      code,
      atMs: Date.now(),
      lastUsedStep: user.mfaLastUsedStep,
    });
    if (!result.valid) {
      await this.recordUpdate(userId, 'Two-factor enrolment code rejected', meta);
      throw new BusinessRuleError('MFA_CODE_INVALID', 'That code is not right. Try the next one.');
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaEnrolledAt: new Date(),
        mfaLastUsedStep: result.step,
        mfaRecoveryCodes: recoveryCodes.map((c) => this.hashRecoveryCode(c)),
      },
    });

    await this.recordUpdate(userId, 'Two-factor authentication enabled', meta);
    return { recoveryCodes };
  }

  /**
   * Accepts a TOTP code or an unused recovery code, spending whichever matched. Answers
   * rather than throws, so the caller decides whether a failure counts towards the
   * lockout. (Cwork.) `replayed` is a right code already spent — what a relayed or
   * shoulder-surfed code looks like — and is reported on the caller's refusal line.
   */
  async consumeFactor(userId: string, code: string): Promise<FactorOutcome> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaSecretEnc: true, mfaLastUsedStep: true, mfaRecoveryCodes: true },
    });

    const secret = this.crypto.decrypt(user.mfaSecretEnc);
    if (secret) {
      const result = verifyTotp({
        secretBase32: secret,
        code,
        atMs: Date.now(),
        lastUsedStep: user.mfaLastUsedStep,
      });
      if (result.valid) {
        // Only if no other request spent this step (or a later one) first.
        const { count } = await this.prisma.user.updateMany({
          where: {
            id: userId,
            OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: result.step! } }],
          },
          data: { mfaLastUsedStep: result.step },
        });
        return count === 1 ? 'accepted' : 'replayed';
      }
      if (result.reason === 'replayed') return 'replayed';
    }

    return (await this.consumeRecoveryCode(userId, code, user.mfaRecoveryCodes))
      ? 'accepted'
      : 'rejected';
  }

  /** Single-use by construction: the digest is removed as it is spent. (Cwork.) */
  private async consumeRecoveryCode(
    userId: string,
    code: string,
    storedDigests: string[],
  ): Promise<boolean> {
    const candidate = normaliseRecoveryCode(code);
    if (candidate.length < 16) return false;

    const digest = this.hashRecoveryCode(candidate);
    const match = storedDigests.find((stored) => this.crypto.safeEquals(stored, digest));
    if (!match) return false;

    const { count } = await this.prisma.user.updateMany({
      // The digest must still be present: of two requests racing with the same code,
      // only the one that finds it there wins.
      where: { id: userId, mfaRecoveryCodes: { has: match } },
      data: { mfaRecoveryCodes: storedDigests.filter((stored) => stored !== match) },
    });
    return count === 1;
  }

  /**
   * Recovery codes carry 100 bits of entropy, so a slow KDF buys nothing over a digest
   * and only adds a way to burn CPU on a half-authenticated endpoint. (Cwork.)
   */
  private hashRecoveryCode(code: string): string {
    return this.crypto.hashToken(normaliseRecoveryCode(code));
  }

  private async recordUpdate(userId: string, summary: string, meta: ClientMeta): Promise<void> {
    await this.audit.record({
      actorUserId: userId,
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: userId,
      summary,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}

// Adapted from Cwork (backend/src/modules/auth/auth.service.ts), see NOTICE. Differences,
// each deliberate:
//  - One company, no organisation claim; no devices or session listing (not in #4).
//  - Every refused sign-in is logged as `auth.sign_in.failed`, counted in
//    `auth_sign_in_failures_total` (docs/TELEMETRY.md) and audited, including attempts
//    against an email no account has (the email itself is never stored).
//  - A correct password does not reset the failure count while a second factor is still
//    owed: in Cwork it does, which lets someone who knows the password try codes forever
//    in batches just under the lockout. The count resets when the sign-in completes.
//  - Cwork's /auth/mfa/complete-enrolment accepts the challenge of an account that is
//    already enrolled, which is a session for a password alone. Here the sign-in of an
//    account that had to enrol completes inside activation instead (`activateMfa`).
import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, UserStatus } from '@prisma/client';
import { APP_CONFIG } from '../../core/config/config.token';
import type { RootConfig } from '../../core/config/configuration';
import {
  AuthenticationError,
  BusinessRuleError,
  NotFoundError,
} from '../../core/errors/domain.errors';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/security/crypto.service';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { MetricsService } from '../../core/telemetry/metrics.service';
import { GENERIC_EVENT, TelemetryLogger } from '../../core/telemetry/telemetry-logger';
import { AuditService } from '../audit/audit.service';
import { passwordProblems } from './domain/password-policy';
import type {
  AuthTokens,
  ChangePasswordDto,
  LoginDto,
  LoginSession,
  MfaChallenge,
  MfaRecoveryCodes,
  SessionUser,
} from './dto/auth.dto';
import { MfaService } from './mfa.service';
import { SessionTokensService, type ClientMeta } from './session-tokens.service';
import { UserContextService } from './user-context.service';

/** The catalogue event for a refused sign-in (docs/TELEMETRY.md v1.2). */
export const SIGN_IN_FAILED_EVENT = 'auth.sign_in.failed';

const invalidCredentials = () =>
  new AuthenticationError('INVALID_CREDENTIALS', 'Invalid email or password');

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: RootConfig,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tokens: SessionTokensService,
    private readonly userContext: UserContextService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly logger: TelemetryLogger,
    private readonly metrics: MetricsService,
  ) {}

  async login(dto: LoginDto, meta: ClientMeta): Promise<LoginSession | MfaChallenge> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, passwordHash: true, status: true, lockedUntil: true },
    });

    // Burn roughly the same time whether or not the account exists, so response timing
    // does not reveal which emails are registered. (Cwork.)
    if (!user) {
      await this.crypto.hashPassword(dto.password);
      await this.signInFailed(null, 'no account has that email', meta);
      throw invalidCredentials();
    }

    await this.refuseIfLocked(user.id, user.lockedUntil, meta);

    if (!(await this.crypto.verifyPassword(user.passwordHash, dto.password))) {
      await this.registerFailedAttempt(user.id, 'wrong password', meta);
      throw invalidCredentials();
    }

    await this.refuseIfDisabled(user.id, user.status, meta);

    // A correct password is not a session when the account owes a second factor. An
    // account that must have one but has not enrolled gets a challenge too, so it can
    // enrol before it can do anything else. (Cwork.)
    const mfa = await this.mfa.requirementFor(user.id);
    if (mfa.enrolled || mfa.required) {
      const challenge = await this.tokens.issueChallenge(user.id, mfa.enrolled);
      return { mfaRequired: true, mfaEnrolled: mfa.enrolled, ...challenge };
    }

    return this.completeLogin(user.id, meta, 'Signed in');
  }

  /**
   * Second half of a sign-in: a challenge token plus a code (or a recovery code) for a
   * session. A wrong code counts towards the same lockout a wrong password does —
   * otherwise the second factor is brute-forceable once the password is known. (Cwork.)
   */
  async verifyMfa(challengeToken: string, code: string, meta: ClientMeta): Promise<LoginSession> {
    const payload = await this.tokens.verifyChallenge(challengeToken);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, mfaEnabled: true, lockedUntil: true },
    });
    if (!user)
      throw new AuthenticationError('SIGN_IN_EXPIRED', 'Sign-in has expired. Start again.');

    await this.refuseIfLocked(user.id, user.lockedUntil, meta);
    if (!user.mfaEnabled) {
      throw new BusinessRuleError(
        'MFA_ENROLMENT_REQUIRED',
        'Set up two-factor authentication to finish signing in.',
      );
    }

    const outcome = await this.mfa.consumeFactor(user.id, code);
    if (outcome !== 'accepted') {
      await this.registerFailedAttempt(
        user.id,
        outcome === 'replayed' ? 'second-factor code already used' : 'wrong second-factor code',
        meta,
      );
      throw new AuthenticationError('SECOND_FACTOR_REJECTED', 'That code is not right');
    }

    await this.refuseIfDisabled(user.id, user.status, meta);
    return this.completeLogin(user.id, meta, 'Signed in with a second factor');
  }

  /**
   * Confirms a pending second factor. From a session it only switches the factor on;
   * with the challenge of an account that had to enrol before signing in, it also
   * finishes that sign-in — the code just proved possession of the new factor.
   */
  async activateMfa(
    subject: { userId: string; viaChallenge: boolean },
    code: string,
    meta: ClientMeta,
  ): Promise<MfaRecoveryCodes & { session?: LoginSession }> {
    if (subject.viaChallenge) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: subject.userId },
        select: { status: true, lockedUntil: true },
      });
      await this.refuseIfLocked(subject.userId, user.lockedUntil, meta);
      await this.refuseIfDisabled(subject.userId, user.status, meta);
    }

    const codes = await this.mfa.activate(subject.userId, code, meta);
    if (!subject.viaChallenge) return codes;

    const session = await this.completeLogin(
      subject.userId,
      meta,
      'Signed in after setting up a second factor',
    );
    return { ...codes, session };
  }

  /**
   * Refresh-token rotation with reuse detection. A token that has already been rotated
   * means it leaked, so its whole family is revoked. (Cwork.)
   */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<AuthTokens> {
    const payload = await this.tokens.verifyRefresh(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.crypto.hashToken(refreshToken) },
    });
    if (!session || session.userId !== payload.sub) {
      throw new AuthenticationError('SESSION_ENDED', 'Invalid or expired refresh token');
    }

    if (session.revokedAt || session.rotatedToId) {
      if (session.revokedReason === 'ROTATED') {
        this.logger.write({
          severity: 'WARNING',
          event: GENERIC_EVENT,
          message: 'A refresh token was used twice; its session family has been revoked',
        });
        await this.tokens.revokeFamily(session.familyId, 'TOKEN_REUSE_DETECTED');
      }
      throw new AuthenticationError('SESSION_ENDED', 'Session has ended, please sign in again');
    }
    if (session.expiresAt < new Date()) {
      throw new AuthenticationError('SESSION_ENDED', 'Refresh token has expired');
    }
    // A disabled account keeps no way back in.
    await this.userContext.resolve(session.userId);

    const tokens = await this.tokens.issue(session.userId, meta, session.familyId);
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        rotatedToId: tokens.sessionId,
        lastUsedAt: new Date(),
        revokedAt: new Date(),
        revokedReason: 'ROTATED',
      },
    });

    const { sessionId: _sessionId, ...pair } = tokens;
    return pair;
  }

  async logout(
    refreshToken: string | undefined,
    user: AuthenticatedUser,
    meta: ClientMeta,
  ): Promise<void> {
    if (refreshToken) {
      await this.prisma.session.updateMany({
        where: {
          userId: user.userId,
          tokenHash: this.crypto.hashToken(refreshToken),
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
      // The access token that made this call names its own session; end it too.
      await this.prisma.session.updateMany({
        where: { id: user.sessionId, userId: user.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
    } else {
      await this.tokens.revokeAll(user.userId, 'LOGOUT_ALL');
    }

    await this.audit.record({
      actorUserId: user.userId,
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: user.userId,
      summary: refreshToken ? 'Signed out' : 'Signed out everywhere',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async changePassword(
    user: AuthenticatedUser,
    dto: ChangePasswordDto,
    meta: ClientMeta,
  ): Promise<void> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { email: true, passwordHash: true },
    });
    if (!record) throw new NotFoundError('User', user.userId);

    if (!(await this.crypto.verifyPassword(record.passwordHash, dto.currentPassword))) {
      throw new BusinessRuleError('INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BusinessRuleError(
        'PASSWORD_UNCHANGED',
        'New password must differ from the current one',
      );
    }
    this.assertPasswordPolicy(dto.newPassword, record.email);

    const passwordHash = await this.crypto.hashPassword(dto.newPassword);

    // Changing a password signs every device out, this one included. (Cwork.)
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await this.tokens.revokeAll(user.userId, 'PASSWORD_CHANGED', tx);
      await this.audit.recordWithin(tx, {
        actorUserId: user.userId,
        action: AuditAction.UPDATE,
        entityType: 'User',
        entityId: user.userId,
        summary: 'Password changed',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    });
  }

  async buildSessionUser(userId: string): Promise<SessionUser> {
    const context = await this.userContext.resolve(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { locale: true, mfaEnabled: true },
    });
    return {
      id: context.userId,
      email: context.email,
      displayName: context.displayName,
      locale: user.locale,
      roles: context.roles,
      permissions: context.permissions,
      mfaEnabled: user.mfaEnabled,
    };
  }

  /** Throws `WEAK_PASSWORD` listing every problem; shared with user creation. */
  assertPasswordPolicy(password: string, email: string): void {
    const problems = passwordProblems({
      password,
      minLength: this.config.auth.passwordMinLength,
      email,
    });
    if (problems.length > 0) {
      throw new BusinessRuleError('WEAK_PASSWORD', `Password ${problems.join(', ')}`, {
        problems,
      });
    }
  }

  /** Issues the session and records the sign-in, whichever route it took. */
  private async completeLogin(
    userId: string,
    meta: ClientMeta,
    summary: string,
  ): Promise<LoginSession> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const { sessionId: _sessionId, ...tokens } = await this.tokens.issue(userId, meta);

    await this.audit.record({
      actorUserId: userId,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: userId,
      summary,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { mfaRequired: false, ...tokens, user: await this.buildSessionUser(userId) };
  }

  private async refuseIfLocked(
    userId: string,
    lockedUntil: Date | null,
    meta: ClientMeta,
  ): Promise<void> {
    if (!lockedUntil || lockedUntil <= new Date()) return;
    await this.signInFailed(userId, 'the account is locked', meta);
    throw new BusinessRuleError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', {
      lockedUntil: lockedUntil.toISOString(),
    });
  }

  private async refuseIfDisabled(
    userId: string,
    status: UserStatus,
    meta: ClientMeta,
  ): Promise<void> {
    if (status === UserStatus.ACTIVE) return;
    await this.signInFailed(userId, 'the account is disabled', meta);
    throw new AuthenticationError('ACCOUNT_DISABLED', 'Account is disabled');
  }

  /** Counts a wrong password or code, locking the account once it reaches the limit. */
  private async registerFailedAttempt(
    userId: string,
    reason: string,
    meta: ClientMeta,
  ): Promise<void> {
    const { maxFailedAttempts, lockoutMinutes } = this.config.auth;
    // Incremented in the database, so concurrent guesses cannot each read the same count.
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });

    let detail = `attempt ${failedLoginCount} of ${maxFailedAttempts}`;
    if (failedLoginCount >= maxFailedAttempts) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000) },
      });
      detail = `account locked for ${lockoutMinutes} minutes`;
    }
    await this.signInFailed(userId, reason, meta, detail);
  }

  /**
   * One refused sign-in: a WARNING line (no email, no account id, no password or code),
   * the failure counter, and the audit entry. `userId` is the account being signed into,
   * or null when the email matched none.
   */
  private async signInFailed(
    userId: string | null,
    reason: string,
    meta: ClientMeta,
    detail?: string,
  ): Promise<void> {
    this.logger.write({
      severity: 'WARNING',
      event: SIGN_IN_FAILED_EVENT,
      message: `Sign-in refused: ${reason}`,
    });
    this.metrics.countSignInFailure();
    await this.audit.record({
      actorUserId: userId,
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      entityId: userId,
      summary: detail ? `Sign-in refused: ${reason} (${detail})` : `Sign-in refused: ${reason}`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}

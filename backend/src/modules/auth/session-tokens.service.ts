// Adapted from Cwork, see NOTICE: `issueTokens` (auth.service.ts), the challenge token
// (mfa.service.ts) and the access-token checks (jwt.strategy.ts), gathered in one place
// because three callers need them. One behaviour differs, on purpose: Cwork refuses
// access tokens issued before `users.sessionsValidFrom`, compared at the one-second
// resolution of the JWT `iat`, which also refuses a token issued in the same second as
// the invalidation. Here every access token names its session, and a revoked session
// stops it at once.
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthenticationError } from '../../core/errors/domain.errors';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { APP_CONFIG } from '../../core/config/config.token';
import type { RootConfig } from '../../core/config/configuration';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/security/crypto.service';
import type { AuthTokens } from './dto/auth.dto';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  /**
   * Absent on a real access token. The challenge token is signed with the same secret,
   * issuer and audience, so this claim is the only thing standing between "password
   * accepted" and a full session. (Cwork.)
   */
  typ?: string;
}

/** Claim marking a token as a half-finished sign-in rather than a session. (Cwork.) */
export const MFA_CHALLENGE_TOKEN_TYPE = 'mfa_challenge';

export interface MfaChallengePayload {
  sub: string;
  typ: typeof MFA_CHALLENGE_TOKEN_TYPE;
  /** Whether the holder has a second factor to present, or still has to enrol. */
  enrolled: boolean;
}

export interface ClientMeta {
  ipAddress?: string;
  userAgent?: string;
}

/** Why a session ended. Only `ROTATED` leaves its last access token usable until expiry. */
export type RevokedReason =
  | 'ROTATED'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'TOKEN_REUSE_DETECTED'
  | 'PASSWORD_CHANGED'
  | 'SECOND_FACTOR_REQUIRED';

/** Sessions whose refresh token, or last access token, can still be used. */
const STILL_OPENS_SOMETHING = {
  OR: [{ revokedAt: null }, { revokedReason: 'ROTATED' }],
} satisfies Prisma.SessionWhereInput;

@Injectable()
export class SessionTokensService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: RootConfig,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
  ) {}

  /** A new session and its token pair. `familyId` continues a rotated session's family. */
  async issue(
    userId: string,
    meta: ClientMeta,
    familyId: string = randomUUID(),
  ): Promise<AuthTokens & { sessionId: string }> {
    const { auth } = this.config;
    const sessionId = randomUUID();
    const claims = { sub: userId, sid: sessionId };
    const common = { issuer: auth.issuer, audience: auth.audience };

    const accessToken = await this.jwt.signAsync(claims, {
      ...common,
      secret: auth.accessSecret,
      expiresIn: auth.accessTtlSeconds,
    });
    const refreshToken = await this.jwt.signAsync(claims, {
      ...common,
      secret: auth.refreshSecret,
      expiresIn: auth.refreshTtlSeconds,
    });

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: this.crypto.hashToken(refreshToken),
        familyId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, 500),
        expiresAt: new Date(Date.now() + auth.refreshTtlSeconds * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: auth.accessTtlSeconds,
      tokenType: 'Bearer',
      sessionId,
    };
  }

  /** Verifies a refresh token's signature; the caller checks its session row. */
  async verifyRefresh(token: string): Promise<{ sub: string; sid: string }> {
    try {
      return await this.jwt.verifyAsync<{ sub: string; sid: string }>(token, {
        secret: this.config.auth.refreshSecret,
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
      });
    } catch {
      throw new AuthenticationError('SESSION_ENDED', 'Invalid or expired refresh token');
    }
  }

  /**
   * The checks every access token passes after its signature: a real session token
   * (not a challenge), whose session belongs to its subject and has not been ended.
   * Returns the user id.
   */
  async assertLiveAccess(
    payload: Pick<AccessTokenPayload, 'sub' | 'sid' | 'typ'>,
  ): Promise<string> {
    if (payload.typ) {
      throw new UnauthorizedException('This token cannot be used to access resources');
    }
    if (!payload.sid) throw new UnauthorizedException('Token is missing a session');

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true, revokedReason: true },
    });
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('Session not found, please sign in again');
    }
    if (session.revokedAt && session.revokedReason !== 'ROTATED') {
      throw new UnauthorizedException('Session has ended, please sign in again');
    }
    return payload.sub;
  }

  /** For the enrolment endpoints, which accept a session as well as a challenge. */
  async verifyAccess(token: string): Promise<string> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.auth.accessSecret,
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return this.assertLiveAccess(payload);
  }

  /**
   * The token handed out after a correct password but before a second factor. It
   * carries a `typ` the access-token checks refuse, so it opens nothing except the
   * second-factor endpoints. Short-lived. (Cwork.)
   */
  async issueChallenge(
    userId: string,
    enrolled: boolean,
  ): Promise<{ challengeToken: string; expiresIn: number }> {
    const payload: MfaChallengePayload = {
      sub: userId,
      typ: MFA_CHALLENGE_TOKEN_TYPE,
      enrolled,
    };
    const challengeToken = await this.jwt.signAsync(payload, {
      secret: this.config.auth.accessSecret,
      expiresIn: this.config.auth.mfaChallengeTtlSeconds,
      issuer: this.config.auth.issuer,
      audience: this.config.auth.audience,
    });
    return { challengeToken, expiresIn: this.config.auth.mfaChallengeTtlSeconds };
  }

  async verifyChallenge(token: string): Promise<MfaChallengePayload> {
    let payload: MfaChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<MfaChallengePayload>(token, {
        secret: this.config.auth.accessSecret,
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
      });
    } catch {
      throw new AuthenticationError('SIGN_IN_EXPIRED', 'Sign-in has expired. Start again.');
    }
    if (payload.typ !== MFA_CHALLENGE_TOKEN_TYPE) {
      throw new AuthenticationError('SIGN_IN_EXPIRED', 'Wrong kind of token for this step');
    }
    return payload;
  }

  /**
   * Ends every session of the user, including the rotated ones whose last access token
   * is still within its lifetime, so every access token stops working at once.
   */
  async revokeAll(
    userId: string,
    reason: RevokedReason,
    client: Pick<Prisma.TransactionClient, 'session'> = this.prisma,
  ): Promise<void> {
    await client.session.updateMany({
      where: { userId, ...STILL_OPENS_SOMETHING },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** The same, for one family: what a replayed refresh token leaked. */
  async revokeFamily(familyId: string, reason: RevokedReason): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, ...STILL_OPENS_SOMETHING },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}

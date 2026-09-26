// Adapted from Cwork (backend/src/modules/auth/auth.controller.ts), see NOTICE. Without
// Cwork's device fields, session listing, MFA disabling and recovery-code regeneration
// (not in #4), and without /auth/mfa/complete-enrolment (see auth.service.ts).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { Public } from '../../core/security/decorators';
import { AuthService } from './auth.service';
import { clientMeta } from './client-meta';
import {
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  MfaActivateDto,
  MfaEnrolDto,
  MfaVerifyDto,
  RefreshTokenDto,
  type AuthTokens,
  type LoginSession,
  type MfaChallenge,
  type MfaEnrolmentOffer,
  type MfaRecoveryCodes,
  type MfaStatus,
  type SessionUser,
} from './dto/auth.dto';
import { MfaService } from './mfa.service';
import { SessionTokensService } from './session-tokens.service';

/**
 * Credential endpoints get a much tighter budget than the global limit.
 *
 * Read straight from the environment because `@Throttle` is evaluated when the class is
 * defined, long before dependency injection exists. `AUTH_THROTTLE_LIMIT` is validated
 * with everything else in env.validation.ts; this is the same value, reached earlier.
 * (Cwork.)
 */
const CREDENTIAL_THROTTLE = {
  default: { limit: Number(process.env.AUTH_THROTTLE_LIMIT ?? 10), ttl: 60_000 },
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly tokens: SessionTokensService,
  ) {}

  /** A session, or — when the account owes a second factor — a challenge. Branch on `mfaRequired`. */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_THROTTLE)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginSession | MfaChallenge> {
    return this.auth.login(dto, clientMeta(req));
  }

  /** Finishes a sign-in with a code from the authenticator app or a recovery code. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  // As tight as the password endpoint: this is the other half of the same door. (Cwork.)
  @Throttle(CREDENTIAL_THROTTLE)
  verifyMfa(@Body() dto: MfaVerifyDto, @Req() req: Request): Promise<LoginSession> {
    return this.auth.verifyMfa(dto.challengeToken, dto.code, clientMeta(req));
  }

  /**
   * Starts enrolment, from a session (adding a second factor voluntarily) or from the
   * challenge of an account that may not sign in until it has one. Hence `@Public()`
   * plus an explicit check of whichever token came. (Cwork.)
   */
  @Public()
  @Post('mfa/enroll')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_THROTTLE)
  async beginMfaEnrolment(
    @Body() dto: MfaEnrolDto,
    @Req() req: Request,
  ): Promise<MfaEnrolmentOffer> {
    const { userId } = await this.resolveMfaSubject(req, dto.challengeToken);
    return this.mfa.beginEnrolment(userId);
  }

  /**
   * Confirms a code to switch the second factor on and returns the recovery codes. With
   * a challenge token it also returns the session that finishes the sign-in.
   */
  @Public()
  @Post('mfa/activate')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_THROTTLE)
  async activateMfa(
    @Body() dto: MfaActivateDto,
    @Req() req: Request,
  ): Promise<MfaRecoveryCodes & { session?: LoginSession }> {
    const subject = await this.resolveMfaSubject(req, dto.challengeToken);
    return this.auth.activateMfa(subject, dto.code, clientMeta(req));
  }

  @Get('mfa/status')
  mfaStatus(@CurrentUser() user: AuthenticatedUser): Promise<MfaStatus> {
    return this.mfa.statusFor(user.userId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken, clientMeta(req));
  }

  /** Ends this session (with its refresh token) or, without one, every session. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @Body() dto: LogoutDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.auth.logout(dto.refreshToken, user, clientMeta(req));
  }

  /** The signed-in user, their roles and effective permissions. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<SessionUser> {
    return this.auth.buildSessionUser(user.userId);
  }

  /** Changes one's own password and signs every device out. */
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: Math.ceil(CREDENTIAL_THROTTLE.default.limit / 2), ttl: 60_000 } })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.auth.changePassword(user, dto, clientMeta(req));
  }

  /**
   * A challenge token wins when supplied; otherwise a Bearer access token is required.
   * Both are verified here, because the route is `@Public()` and no guard has run.
   */
  private async resolveMfaSubject(
    req: Request,
    challengeToken?: string,
  ): Promise<{ userId: string; viaChallenge: boolean }> {
    if (challengeToken) {
      const payload = await this.tokens.verifyChallenge(challengeToken);
      return { userId: payload.sub, viaChallenge: true };
    }
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!bearer) {
      throw new UnauthorizedException('Sign in, or supply the challenge token from /auth/login');
    }
    return { userId: await this.tokens.verifyAccess(bearer), viaChallenge: false };
  }
}

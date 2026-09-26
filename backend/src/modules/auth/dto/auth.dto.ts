// Adapted from Cwork (backend/src/modules/auth/dto/auth.dto.ts), see NOTICE. The ERP has
// no Swagger module yet, so Cwork's @ApiProperty annotations are left out.
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PermissionKey, Role } from '../../../core/security/permissions';

const trimLower = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  @trimLower()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  refreshToken!: string;
}

export class LogoutDto {
  /** Signs out this session only; without it, every session of the account ends. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword!: string;

  // Length and the rest of the policy are checked by the service, against configuration.
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  newPassword!: string;
}

export class MfaCodeDto {
  /** Six digits from the authenticator app, or an unused recovery code. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}

export class MfaVerifyDto extends MfaCodeDto {
  /** The `challengeToken` returned by /auth/login. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  challengeToken!: string;
}

export class MfaChallengeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  challengeToken!: string;
}

export class MfaEnrolDto {
  /** When enrolling mid-sign-in rather than from a session. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  challengeToken?: string;
}

export class MfaActivateDto extends MfaCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  challengeToken?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  roles: Role[];
  permissions: PermissionKey[];
  mfaEnabled: boolean;
}

export interface LoginSession extends AuthTokens {
  mfaRequired: false;
  user: SessionUser;
}

/**
 * What `POST /auth/login` returns when the password was right but the account still
 * owes a second factor. Clients branch on `mfaRequired`. (Cwork.)
 */
export interface MfaChallenge {
  mfaRequired: true;
  /** False when the account must set up a second factor before it can sign in. */
  mfaEnrolled: boolean;
  /** Short-lived token that opens only the second-factor endpoints. */
  challengeToken: string;
  expiresIn: number;
}

export interface MfaEnrolmentOffer {
  /** Base32 secret, shown once for manual entry. */
  secret: string;
  /** `otpauth://` URI for the QR code. */
  otpauthUri: string;
}

export interface MfaRecoveryCodes {
  /** Shown once and never again; only their digests are kept. */
  recoveryCodes: string[];
}

export interface MfaStatus {
  required: boolean;
  enrolled: boolean;
  enrolledAt: string | null;
  recoveryCodesRemaining: number;
}

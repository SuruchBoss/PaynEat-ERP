// The shapes of the API's authentication answers (backend `modules/auth/dto/auth.dto.ts`).
import type { Role } from '@/lib/access';
import type { AuthTokens } from '@/lib/api-client';

export type { AuthTokens };

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  roles: Role[];
  permissions: string[];
  mfaEnabled: boolean;
}

export interface LoginSession extends AuthTokens {
  mfaRequired: false;
  user: SessionUser;
}

/** A correct password for an account that owes a second factor. Not a session. */
export interface MfaChallenge {
  mfaRequired: true;
  /** False when the account has to set up a second factor before it can sign in. */
  mfaEnrolled: boolean;
  challengeToken: string;
  expiresIn: number;
}

export type LoginResponse = LoginSession | MfaChallenge;

export interface MfaEnrolmentOffer {
  secret: string;
  otpauthUri: string;
}

export interface MfaActivation {
  recoveryCodes: string[];
  /** Present when activation finished a sign-in (it was reached with a challenge). */
  session?: LoginSession;
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Signing in and user administration in the demo API (#41, ADR-0021). The roles, their
 * permissions and the password policy are the backend's own, imported; the order of the
 * checks follows its `modules/auth` services (auth.service.ts, mfa.service.ts,
 * users.service.ts). Passwords are compared in the clear because every demo password is
 * already published; nothing here is a model for real credential handling.
 */
import { passwordProblems } from '@backend/src/modules/auth/domain/password-policy';
import {
  isRole,
  permissionsFor,
  requiresSecondFactor,
  ROLE_KEYS,
  type Role,
} from '@backend/src/core/security/permissions';
import {
  conflict,
  DemoError,
  Input,
  refused,
  unauthenticated,
  uuidParam,
  type Context,
} from './http';
import { id, type DemoState, type UserRecord } from './state';
import { acceptedStep, base32Encode, normaliseRecoveryCode } from './totp';

/** backend env defaults: AUTH_MAX_FAILED_ATTEMPTS, AUTH_LOCKOUT_MINUTES, the TTLs. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const PASSWORD_MIN_LENGTH = 12;
const ACCESS_TTL_SECONDS = 900;
const REFRESH_TTL_SECONDS = 604_800;
const CHALLENGE_TTL_SECONDS = 300;
const TOTP_ISSUER = 'PaynEat ERP';

export { permissionsFor };

// --- Tokens ----------------------------------------------------------------------------------

/**
 * `demo-<kind>.<user id>.<issued at>.<random>`: a token says whose it is and when it was
 * issued, so a session kept in the browser survives a reload even though the data does not.
 * Nothing is signed: there is nothing here worth protecting.
 */
function issue(kind: 'access' | 'refresh', userId: string, now: number): string {
  const random = base32Encode(crypto.getRandomValues(new Uint8Array(10)));
  return `demo-${kind}.${userId}.${now}.${random}`;
}

function readToken(token: string, kind: 'access' | 'refresh') {
  const [prefix, userId, issuedAt] = token.split('.');
  if (prefix !== `demo-${kind}` || !userId || !/^\d+$/.test(issuedAt ?? '')) return null;
  return { userId, issuedAt: Number(issuedAt) };
}

function tokenStillValid(
  state: DemoState,
  token: string,
  kind: 'access' | 'refresh',
  now: number,
): UserRecord | null {
  const parsed = readToken(token, kind);
  if (!parsed || state.revokedTokens.has(token)) return null;
  const ttl = kind === 'access' ? ACCESS_TTL_SECONDS : REFRESH_TTL_SECONDS;
  if (now - parsed.issuedAt > ttl * 1000) return null;
  const user = state.users.find((u) => u.id === parsed.userId);
  if (!user || user.status !== 'ACTIVE') return null;
  if (user.sessionsEndedAt !== null && parsed.issuedAt <= user.sessionsEndedAt) return null;
  return user;
}

/** The signed-in user behind a request's Bearer token; 401 like the API's JWT guard. */
export function sessionUser(state: DemoState, headers: Headers, now: number): UserRecord {
  const header = headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const user = token ? tokenStillValid(state, token, 'access', now) : null;
  if (!user) throw unauthenticated('UNAUTHENTICATED', 'Unauthorized');
  return user;
}

function tokens(userId: string, now: number) {
  return {
    accessToken: issue('access', userId, now),
    refreshToken: issue('refresh', userId, now),
    expiresIn: ACCESS_TTL_SECONDS,
    tokenType: 'Bearer' as const,
  };
}

// --- Views -----------------------------------------------------------------------------------

const byRoleOrder = (roles: readonly Role[]) =>
  [...roles].sort((a, b) => ROLE_KEYS.indexOf(a) - ROLE_KEYS.indexOf(b));

export function sessionView(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    roles: byRoleOrder(user.roles),
    permissions: permissionsFor(user.roles),
    mfaEnabled: user.mfaEnabled,
  };
}

function userView(user: UserRecord) {
  const roles = byRoleOrder(user.roles);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    status: user.status,
    roles,
    mfaEnabled: user.mfaEnabled,
    mfaRequired: requiresSecondFactor(roles),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

// --- Signing in ------------------------------------------------------------------------------

const invalidCredentials = () =>
  unauthenticated('INVALID_CREDENTIALS', 'Invalid email or password');

function refuseIfLocked(user: UserRecord, now: number): void {
  if (user.lockedUntil === null || user.lockedUntil <= now) return;
  throw refused('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', {
    lockedUntil: new Date(user.lockedUntil).toISOString(),
  });
}

function refuseIfDisabled(user: UserRecord): void {
  if (user.status !== 'ACTIVE') throw unauthenticated('ACCOUNT_DISABLED', 'Account is disabled');
}

/** A wrong password or code; the fifth in a row locks the account for a while. */
function registerFailedAttempt(user: UserRecord, now: number): void {
  user.failedLogins += 1;
  if (user.failedLogins >= MAX_FAILED_ATTEMPTS) {
    user.failedLogins = 0;
    user.lockedUntil = now + LOCKOUT_MINUTES * 60_000;
  }
}

function completeLogin(user: UserRecord, now: number) {
  user.failedLogins = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date(now).toISOString();
  return { mfaRequired: false as const, ...tokens(user.id, now), user: sessionView(user) };
}

function challengeUser(state: DemoState, token: string, now: number): UserRecord {
  const challenge = state.challenges.get(token);
  const user = challenge && state.users.find((u) => u.id === challenge.userId);
  if (!challenge || challenge.expiresAt < now || !user) {
    throw unauthenticated('SIGN_IN_EXPIRED', 'Sign-in has expired. Start again.');
  }
  return user;
}

export function login(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['email', 'password']);
  const email = input.text('email', { trim: true, lower: true, email: true, max: 255 });
  const password = input.text('password', { notEmpty: true, max: 256 });
  input.done();

  const user = state.users.find((u) => u.email === email);
  if (!user) throw invalidCredentials();
  refuseIfLocked(user, ctx.now);
  if (user.password !== password) {
    registerFailedAttempt(user, ctx.now);
    throw invalidCredentials();
  }
  refuseIfDisabled(user);

  if (user.mfaEnabled || requiresSecondFactor(user.roles)) {
    const challengeToken = `demo-challenge.${id()}`;
    state.challenges.set(challengeToken, {
      userId: user.id,
      expiresAt: ctx.now + CHALLENGE_TTL_SECONDS * 1000,
    });
    return {
      mfaRequired: true,
      mfaEnrolled: user.mfaEnabled,
      challengeToken,
      expiresIn: CHALLENGE_TTL_SECONDS,
    };
  }
  return completeLogin(user, ctx.now);
}

/** A TOTP code, or an unused recovery code, which is spent. */
async function consumeFactor(user: UserRecord, code: string, now: number): Promise<boolean> {
  if (user.mfaSecret) {
    const step = await acceptedStep(user.mfaSecret, code, now, user.lastUsedStep);
    if (step !== null) {
      user.lastUsedStep = step;
      return true;
    }
  }
  const candidate = normaliseRecoveryCode(code);
  if (candidate.length < 16) return false;
  const index = user.recoveryCodes.indexOf(candidate);
  if (index === -1) return false;
  user.recoveryCodes.splice(index, 1);
  return true;
}

export async function verifyMfa(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['challengeToken', 'code']);
  const challengeToken = input.text('challengeToken', { notEmpty: true, max: 2048 });
  const code = input.text('code', { notEmpty: true, max: 64 });
  input.done();

  const user = challengeUser(state, challengeToken, ctx.now);
  refuseIfLocked(user, ctx.now);
  if (!user.mfaEnabled) {
    throw refused(
      'MFA_ENROLMENT_REQUIRED',
      'Set up two-factor authentication to finish signing in.',
    );
  }
  if (!(await consumeFactor(user, code, ctx.now))) {
    registerFailedAttempt(user, ctx.now);
    throw unauthenticated('SECOND_FACTOR_REJECTED', 'That code is not right');
  }
  refuseIfDisabled(user);
  return completeLogin(user, ctx.now);
}

/** A challenge token wins; otherwise the request must carry a session. */
function mfaSubject(state: DemoState, ctx: Context, challengeToken: string | null | undefined) {
  if (challengeToken) {
    return { user: challengeUser(state, challengeToken, ctx.now), viaChallenge: true };
  }
  return { user: sessionUser(state, ctx.headers, ctx.now), viaChallenge: false };
}

export function beginEnrolment(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['challengeToken']);
  const challengeToken = input.optionalText('challengeToken', { max: 2048 });
  input.done();

  const { user } = mfaSubject(state, ctx, challengeToken);
  if (user.mfaEnabled) {
    throw refused(
      'MFA_ALREADY_ENROLLED',
      'Two-factor authentication is already set up for this account.',
    );
  }
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  user.mfaSecret = secret;
  user.lastUsedStep = null;
  const label = `${TOTP_ISSUER}:${user.email}`;
  const params = new URLSearchParams({
    secret,
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return { secret, otpauthUri: `otpauth://totp/${encodeURIComponent(label)}?${params}` };
}

function recoveryCode(): string {
  const raw = base32Encode(crypto.getRandomValues(new Uint8Array(13))).slice(0, 20);
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

export async function activateMfa(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['challengeToken', 'code']);
  const challengeToken = input.optionalText('challengeToken', { max: 2048 });
  const code = input.text('code', { notEmpty: true, max: 64 });
  input.done();

  const { user, viaChallenge } = mfaSubject(state, ctx, challengeToken);
  if (viaChallenge) {
    refuseIfLocked(user, ctx.now);
    refuseIfDisabled(user);
  }
  if (user.mfaEnabled) {
    throw refused('MFA_ALREADY_ENROLLED', 'Two-factor authentication is already on.');
  }
  if (!user.mfaSecret) {
    throw refused('MFA_NOT_STARTED', 'Start enrolment before confirming a code.');
  }
  const step = await acceptedStep(user.mfaSecret, code, ctx.now, user.lastUsedStep);
  if (step === null) {
    throw refused('MFA_CODE_INVALID', 'That code is not right. Try the next one.');
  }
  const recoveryCodes = Array.from({ length: 10 }, recoveryCode);
  user.mfaEnabled = true;
  user.mfaEnrolledAt = new Date(ctx.now).toISOString();
  user.lastUsedStep = step;
  user.recoveryCodes = recoveryCodes.map(normaliseRecoveryCode);
  return viaChallenge
    ? { recoveryCodes, session: completeLogin(user, ctx.now) }
    : { recoveryCodes };
}

export function refresh(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['refreshToken']);
  const refreshToken = input.text('refreshToken', { notEmpty: true, max: 1024 });
  input.done();

  const user = tokenStillValid(state, refreshToken, 'refresh', ctx.now);
  if (!user) throw unauthenticated('SESSION_ENDED', 'Session has ended, please sign in again');
  state.revokedTokens.add(refreshToken);
  return tokens(user.id, ctx.now);
}

export function logout(state: DemoState, ctx: Context): undefined {
  const input = new Input(ctx.body, ['refreshToken']);
  const refreshToken = input.optionalText('refreshToken', { max: 1024 });
  input.done();

  const user = ctx.actor!;
  if (refreshToken) {
    state.revokedTokens.add(refreshToken);
    const header = ctx.headers.get('authorization') ?? '';
    state.revokedTokens.add(header.slice('Bearer '.length));
  } else {
    user.sessionsEndedAt = ctx.now;
  }
  return undefined;
}

export function me(_state: DemoState, ctx: Context) {
  return sessionView(ctx.actor!);
}

export function mfaStatus(_state: DemoState, ctx: Context) {
  const user = ctx.actor!;
  return {
    required: requiresSecondFactor(user.roles),
    enrolled: user.mfaEnabled,
    enrolledAt: user.mfaEnrolledAt,
    recoveryCodesRemaining: user.recoveryCodes.length,
  };
}

// --- Users -----------------------------------------------------------------------------------

export function roles() {
  return ROLE_KEYS.map((key) => ({
    key,
    permissions: permissionsFor([key]),
    requiresSecondFactor: requiresSecondFactor([key]),
  }));
}

export function listUsers(state: DemoState) {
  return [...state.users].sort((a, b) => (a.email < b.email ? -1 : 1)).map(userView);
}

function findUser(state: DemoState, userId: string): UserRecord {
  const user = state.users.find((u) => u.id === uuidParam(userId));
  if (!user) throw new DemoError(404, 'RESOURCE_NOT_FOUND', `User '${userId}' was not found`);
  return user;
}

export function getUser(state: DemoState, ctx: Context) {
  return userView(findUser(state, ctx.params[0]));
}

export function createUser(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['email', 'displayName', 'password', 'locale', 'roles']);
  const email = input.text('email', { trim: true, lower: true, email: true, max: 255 });
  const displayName = input.text('displayName', { trim: true, notEmpty: true, max: 120 });
  const password = input.text('password', { notEmpty: true, max: 256 });
  const locale = input.optionalText('locale', { oneOf: ['th', 'en'] }) as 'th' | 'en' | undefined;
  const roles =
    input.list(
      'roles',
      { max: ROLE_KEYS.length, optional: true, unique: true },
      (role, prefix, p) => {
        if (!isRole(role)) p.push(`${prefix.slice(0, -1)} must be one of the following values`);
        return role as Role;
      },
    ) ?? [];
  input.done();

  const problems = passwordProblems({ password, minLength: PASSWORD_MIN_LENGTH, email });
  if (problems.length > 0) {
    throw refused('WEAK_PASSWORD', `Password ${problems.join(', ')}`, { problems });
  }
  if (state.users.some((u) => u.email === email)) {
    throw conflict('EMAIL_TAKEN', 'A user with this email already exists');
  }
  const at = new Date(ctx.now).toISOString();
  const user: UserRecord = {
    id: id(),
    email,
    displayName,
    password,
    locale: locale ?? 'th',
    status: 'ACTIVE',
    roles: [...new Set(roles)],
    mfaEnabled: false,
    mfaEnrolledAt: null,
    mfaSecret: null,
    recoveryCodes: [],
    lastUsedStep: null,
    failedLogins: 0,
    lockedUntil: null,
    sessionsEndedAt: null,
    lastLoginAt: null,
    createdAt: at,
  };
  state.users.push(user);
  return userView(user);
}

function roleParams(state: DemoState, ctx: Context): { user: UserRecord; role: Role } {
  const [userId, role] = ctx.params;
  if (!isRole(role)) {
    throw new DemoError(400, 'VALIDATION_FAILED', 'role must be one of the following values', [
      'role must be one of the following values',
    ]);
  }
  return { user: findUser(state, userId), role };
}

/** Idempotent. A role that demands a second factor ends the sessions of a user without one. */
export function grantRole(state: DemoState, ctx: Context) {
  const { user, role } = roleParams(state, ctx);
  if (!user.roles.includes(role)) {
    user.roles = [...user.roles, role];
    if (requiresSecondFactor(user.roles) && !user.mfaEnabled) user.sessionsEndedAt = ctx.now;
  }
  return userView(user);
}

/** Idempotent. The last active administrator keeps the role. */
export function revokeRole(state: DemoState, ctx: Context) {
  const { user, role } = roleParams(state, ctx);
  if (!user.roles.includes(role)) return userView(user);
  if (role === 'admin') {
    const otherAdmins = state.users.filter(
      (u) => u.id !== user.id && u.status === 'ACTIVE' && u.roles.includes('admin'),
    );
    if (otherAdmins.length === 0) {
      throw conflict(
        'LAST_ADMIN',
        'This is the only active administrator; give the admin role to someone else first',
      );
    }
  }
  user.roles = user.roles.filter((r) => r !== role);
  return userView(user);
}

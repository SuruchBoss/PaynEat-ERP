/**
 * Signing in from the end-to-end suite, through the real HTTP API only. The one thing
 * read from the database directly is the demo admin's last spent second-factor step, so
 * the suite can produce a code the API will accept instead of guessing and failing.
 */
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { generateTotpForStep, timeStepAt } from 'src/modules/auth/domain/totp';
import { DEMO_MFA_SECRET, DEMO_PASSWORD, DEMO_USERS } from '../../prisma/seed';
import { resolveDatabaseUrl } from './database';

export const API = '/api/v1';

// Response bodies asserted field by field, as test-app.ts does with log lines.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = Record<string, any>;

export const demoEmail = (role: string): string => {
  const user = DEMO_USERS.find((u) => u.role === role);
  if (!user) throw new Error(`no demo user for ${role}`);
  return user.email;
};

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; roles: string[]; permissions: string[] };
}

export const bearer = (session: { accessToken: string }) => `Bearer ${session.accessToken}`;

/** A session for an account without a second factor; fails the test otherwise. */
export async function signIn(
  server: Server,
  email: string,
  password: string = DEMO_PASSWORD,
): Promise<Session> {
  const res = await request(server).post(`${API}/auth/login`).send({ email, password });
  if (res.status !== 200 || res.body.mfaRequired !== false) {
    throw new Error(`sign-in of ${email} gave ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as Session;
}

/**
 * The first code the API will accept for this secret: the current step, or the one
 * after the step last spent, which the verifier still takes. When both are spent, waits
 * for the next step rather than failing. `lastUsedStep` is what the database holds.
 */
export async function acceptableCode(secret: string, lastUsedStep: number | null): Promise<string> {
  for (;;) {
    const current = timeStepAt(Date.now());
    const step = lastUsedStep === null ? current : Math.max(current, lastUsedStep + 1);
    if (step <= current + 1) return generateTotpForStep(secret, step);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function lastUsedStep(email: string): Promise<number | null> {
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { mfaLastUsedStep: true },
    });
    return user.mfaLastUsedStep;
  } finally {
    await prisma.$disconnect();
  }
}

/** Password, then the second factor, for an account with the given TOTP secret. */
export async function signInWithSecondFactor(
  server: Server,
  email: string,
  secret: string,
  password: string = DEMO_PASSWORD,
): Promise<Session> {
  const login = await request(server).post(`${API}/auth/login`).send({ email, password });
  if (login.status !== 200 || login.body.mfaRequired !== true) {
    throw new Error(`sign-in of ${email} gave ${login.status} ${JSON.stringify(login.body)}`);
  }
  const code = await acceptableCode(secret, await lastUsedStep(email));
  const res = await request(server)
    .post(`${API}/auth/mfa/verify`)
    .send({ challengeToken: login.body.challengeToken, code });
  if (res.status !== 200) {
    throw new Error(`second factor of ${email} gave ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as Session;
}

/** The demo admin, signed in with the published password and second-factor secret. */
export function signInAsAdmin(server: Server): Promise<Session> {
  return signInWithSecondFactor(server, demoEmail('admin'), DEMO_MFA_SECRET);
}

let counter = 0;
/** A unique email for a user a test creates, so specs never collide in the shared database. */
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}${counter}@e2e.example`;
}

/** A password the policy accepts, never one of the published demo ones. */
export const TEST_PASSWORD = 'crispy wings every friday';

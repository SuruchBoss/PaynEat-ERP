// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Demo seed: builds the fictional fried-chicken chain on an empty database.
 *
 * EVALUATION ONLY — never a real installation. The chain is invented and refers to no
 * real company (CLAUDE.md), and every credential below is published in this repository.
 * Today it creates the company and one user per role (#4); later tickets extend it with
 * the plant, three branches, two suppliers, items and the whole supplier-to-plate path,
 * so that one command still builds everything.
 *
 * Safe to re-run: every write is an upsert keyed on a natural key, and re-running puts
 * the demo accounts back as described (password, role, second factor, no lockout).
 * Structure and the demo second-factor approach adapted from Cwork's prisma/seed.ts,
 * see NOTICE.
 */
import 'dotenv/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { PrismaClient, type RoleKey } from '@prisma/client';
import { normaliseRecoveryCode } from '../src/modules/auth/domain/totp';

export const DEMO_COMPANY = {
  code: 'DEMO-CHICKEN',
  name: 'PaynEat Demo Fried Chicken Co., Ltd. (fictional)',
  nameTh: 'บริษัท เพย์นอีท เดโม ไก่ทอด จำกัด (สมมติ)',
} as const;

/** The published password of every demo account. */
export const DEMO_PASSWORD = 'demo-chicken-2026';

/**
 * The published second-factor secret of the demo admin account (base32, 20 bytes).
 * Add it to any authenticator app once; `README.md` shows how. A real person enrols
 * with their own secret through the console, and nothing real ever uses this one.
 */
export const DEMO_MFA_SECRET = 'PAYNEATERPDEMOTWOFACTORSECRET234';

/** Single-use codes that work in place of an authenticator code; restored on every run. */
export const DEMO_RECOVERY_CODES = [
  'DEMOC-HICKE-NRCVR-YAAA2',
  'DEMOC-HICKE-NRCVR-YBBB3',
  'DEMOC-HICKE-NRCVR-YCCC4',
  'DEMOC-HICKE-NRCVR-YDDD5',
  'DEMOC-HICKE-NRCVR-YEEE6',
] as const;

export interface DemoUser {
  email: string;
  displayName: string;
  role: RoleKey;
}

/** One account per role of ADR-0008. Only `admin` needs a second factor. */
export const DEMO_USERS: readonly DemoUser[] = [
  { role: 'admin', email: 'admin@demo-chicken.example', displayName: 'Demo admin' },
  { role: 'purchasing', email: 'purchasing@demo-chicken.example', displayName: 'Demo purchasing' },
  {
    role: 'purchasing_approver',
    email: 'approver@demo-chicken.example',
    displayName: 'Demo purchasing approver',
  },
  { role: 'plant', email: 'plant@demo-chicken.example', displayName: 'Demo plant' },
  { role: 'logistics', email: 'logistics@demo-chicken.example', displayName: 'Demo logistics' },
  {
    role: 'branch_manager',
    email: 'branch.manager@demo-chicken.example',
    displayName: 'Demo branch manager',
  },
  { role: 'finance', email: 'finance@demo-chicken.example', displayName: 'Demo finance' },
];

/** A refusal, not a crash: printed as a message with no stack trace. (Cwork.) */
class SeedRefused extends Error {}

/** Mirrors CryptoService.encrypt: `v1:iv:tag:ciphertext`, AES-256-GCM. */
function encryptField(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Mirrors MfaService's digest of a recovery code. */
function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.FIELD_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) {
    throw new SeedRefused(
      'FIELD_ENCRYPTION_KEY is missing or is not a base64 32-byte key. The demo admin\n' +
        "account's second factor is stored encrypted with the same key the API uses, so\n" +
        'set it as the API has it (README.md, "Try it").',
    );
  }
  return key;
}

/**
 * Refuses to seed a database that belongs to somebody real. One installation serves one
 * company (ADR-0001); if it is not the demo company, published credentials have no
 * business being added beside it. (Cwork's guard, adapted.)
 */
async function assertDemoDatabase(prisma: PrismaClient): Promise<void> {
  const foreign = await prisma.company.findFirst({
    where: { code: { not: DEMO_COMPANY.code } },
    select: { code: true, name: true },
  });
  if (!foreign) return;
  throw new SeedRefused(
    [
      `This database already holds "${foreign.name}" (${foreign.code}), which the demo seed did not create.`,
      '',
      'The seed is evaluation-only: it creates accounts with a published password and a',
      'published second-factor secret. Nothing has been written. Point DATABASE_URL at a',
      'throwaway database.',
    ].join('\n'),
  );
}

async function seedUsers(prisma: PrismaClient, key: Buffer): Promise<void> {
  const passwordHash = await argonHash(DEMO_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const demo of DEMO_USERS) {
    const secondFactor =
      demo.role === 'admin'
        ? {
            mfaEnabled: true,
            mfaSecretEnc: encryptField(DEMO_MFA_SECRET, key),
            mfaEnrolledAt: new Date(),
            mfaLastUsedStep: null,
            mfaRecoveryCodes: DEMO_RECOVERY_CODES.map(hashRecoveryCode),
          }
        : {
            mfaEnabled: false,
            mfaSecretEnc: null,
            mfaEnrolledAt: null,
            mfaLastUsedStep: null,
            mfaRecoveryCodes: [],
          };
    const state = {
      displayName: demo.displayName,
      passwordHash,
      status: 'ACTIVE' as const,
      locale: 'th',
      failedLoginCount: 0,
      lockedUntil: null,
      ...secondFactor,
    };

    const user = await prisma.user.upsert({
      where: { email: demo.email },
      create: { email: demo.email, ...state },
      update: state,
    });
    // Exactly the one role, whatever an evaluator gave or took away since.
    await prisma.userRole.deleteMany({ where: { userId: user.id, role: { not: demo.role } } });
    await prisma.userRole.createMany({
      data: [{ userId: user.id, role: demo.role }],
      skipDuplicates: true,
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding PaynEat ERP with DEMO DATA — evaluation only, never a real installation.');
  const prisma = new PrismaClient();
  try {
    const key = encryptionKey();
    await assertDemoDatabase(prisma);

    const company = await prisma.company.upsert({
      where: { code: DEMO_COMPANY.code },
      update: { name: DEMO_COMPANY.name, nameTh: DEMO_COMPANY.nameTh },
      create: { ...DEMO_COMPANY },
    });
    console.log(`Demo company ready: ${company.code} — ${company.name}`);

    await seedUsers(prisma, key);
    console.log(`\nDemo accounts (password for all: ${DEMO_PASSWORD}):`);
    for (const demo of DEMO_USERS) {
      console.log(`  ${demo.role.padEnd(20)} ${demo.email}`);
    }
    console.log('\n  admin also needs a second factor. Add this secret to any authenticator app:');
    console.log(`    secret : ${DEMO_MFA_SECRET}`);
    console.log(
      `    or QR  : otpauth://totp/${encodeURIComponent('PaynEat ERP:admin@demo-chicken.example')}` +
        `?secret=${DEMO_MFA_SECRET}&issuer=PaynEat%20ERP&algorithm=SHA1&digits=6&period=30`,
    );
    console.log('  Recovery codes (single use, work in place of a code; restored on every run):');
    for (const code of DEMO_RECOVERY_CODES) console.log(`    ${code}`);
    console.log(
      '\n  Every credential above is published in this repository. Never use them anywhere real.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    if (error instanceof SeedRefused) {
      console.error(`\nSeed refused.\n\n${error.message}\n`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}

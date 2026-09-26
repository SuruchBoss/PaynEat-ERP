// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Demo seed: builds the fictional fried-chicken chain on an empty database.
 *
 * EVALUATION ONLY — never a real installation. The chain is invented and refers to no
 * real company (CLAUDE.md), and every credential below is published in this repository.
 * So it runs only with ERP_DEMO=1 and never under NODE_ENV=production, and it marks every
 * account it creates as a demo account: a production API refuses to start while one is
 * enabled without ERP_DEMO=1, and refuses their sign-in (#5, `domain/demo-mode.ts`).
 * Today it creates the company, one user per role (#4), the items (#5), the plant, three
 * branches and two suppliers (#6), and the plant's opening balance (#7); later tickets extend
 * it along the supplier-to-plate path, so that one command still builds everything.
 *
 * Safe to re-run: every write is an upsert keyed on a natural key, and re-running puts
 * the demo accounts back as described (password, role, second factor, no lockout).
 * Structure and the demo second-factor approach adapted from Cwork's prisma/seed.ts,
 * see NOTICE.
 */
import 'dotenv/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { AuditAction, MasterDataAction, Prisma, PrismaClient } from '@prisma/client';
import { seedRefusal } from '../src/modules/auth/domain/demo-mode';
import { inTransitCode } from '../src/modules/locations/domain/location-rules';
import { normaliseRecoveryCode } from '../src/modules/auth/domain/totp';
import { addDays } from '../src/core/time/domain/business-date';
import { ledgerServices } from './ledger-services';

import {
  DEMO_COMPANY,
  DEMO_ITEMS,
  DEMO_LOCATIONS,
  DEMO_MFA_SECRET,
  DEMO_OPENING_BALANCE,
  DEMO_PASSWORD,
  DEMO_RECOVERY_CODES,
  DEMO_SUPPLIERS,
  DEMO_USERS,
} from './demo-data';

// The demo data lives in its own module so the console's public demo can import it (ADR-0021);
// the seed's tests and scripts keep importing it from here.
export * from './demo-data';

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
      demo: true,
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

/**
 * Creates the demo items, or puts back any an evaluator changed. Like the API, every
 * create or update takes the next master data version and appends its change, so a POS
 * pulling from version 0 sees the demo items; an item already as described is left alone
 * and keeps its version. (Mirrors ItemsService, which a script cannot boot.)
 */
async function seedItems(prisma: PrismaClient): Promise<number> {
  let changed = 0;
  for (const demo of DEMO_ITEMS) {
    const wanted = {
      nameTh: demo.nameTh,
      nameEn: demo.nameEn,
      baseUnitCode: demo.baseUnitCode,
      variableWeight: demo.variableWeight,
      shelfLifeDays: demo.shelfLifeDays,
      active: true,
    };
    await prisma.$transaction(async (tx) => {
      const existing = await tx.item.findUnique({
        where: { code: demo.code },
        include: { purchaseUnits: { orderBy: { unitCode: 'asc' } } },
      });
      const same =
        existing &&
        Object.entries(wanted).every(([k, v]) => existing[k as keyof typeof wanted] === v) &&
        JSON.stringify(existing.purchaseUnits.map((p) => [p.unitCode, p.factor.toFixed()])) ===
          JSON.stringify(demo.purchaseUnits.map((p) => [p.unitCode, p.factor]));
      if (same) return;

      const [{ version }] = await tx.$queryRaw<{ version: bigint }[]>`
        INSERT INTO master_data_version (id, version) VALUES (1, 1)
        ON CONFLICT (id) DO UPDATE SET version = master_data_version.version + 1
        RETURNING version
      `;
      const item = existing
        ? await tx.item.update({ where: { id: existing.id }, data: { ...wanted, version } })
        : await tx.item.create({ data: { code: demo.code, ...wanted, version } });
      await tx.itemPurchaseUnit.deleteMany({ where: { itemId: item.id } });
      await tx.itemPurchaseUnit.createMany({
        data: demo.purchaseUnits.map((p) => ({ itemId: item.id, ...p })),
      });

      const snapshot = {
        id: item.id,
        itemCode: item.code,
        ...wanted,
        purchaseUnits: demo.purchaseUnits,
      };
      await tx.masterDataChange.create({
        data: {
          version,
          entityType: 'item',
          entityId: item.id,
          entityCode: item.code,
          action: existing ? MasterDataAction.updated : MasterDataAction.created,
          data: { ...snapshot, version: Number(version) } as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
          entityType: 'Item',
          entityId: item.id,
          summary: `Demo seed ${existing ? 'restored' : 'created'} item ${item.code} (${item.nameEn})`,
          changes: snapshot as Prisma.InputJsonValue,
        },
      });
      changed += 1;
    });
  }
  return changed;
}

/** Takes the next master data version inside `tx` (mirrors MasterDataService). */
async function nextMasterDataVersion(tx: Prisma.TransactionClient): Promise<bigint> {
  const [{ version }] = await tx.$queryRaw<{ version: bigint }[]>`
    INSERT INTO master_data_version (id, version) VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE SET version = master_data_version.version + 1
    RETURNING version
  `;
  return version;
}

/**
 * Creates the chain's sites, or puts back names or an active flag an evaluator changed.
 * A branch is master data, so each branch it writes takes a master data version and a
 * change, as the API does (mirrors LocationsService, which a script cannot boot). Codes
 * are never rewritten: an evaluator's code correction stands.
 */
async function seedLocations(prisma: PrismaClient): Promise<number> {
  let changed = 0;
  for (const demo of DEMO_LOCATIONS) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.location.findUnique({ where: { code: demo.code } });
      const wanted = { nameTh: demo.nameTh, nameEn: demo.nameEn, active: true };
      if (
        existing &&
        existing.nameTh === wanted.nameTh &&
        existing.nameEn === wanted.nameEn &&
        existing.active
      ) {
        return;
      }
      if (existing?.supersededById) return;

      const version = demo.type === 'branch' ? await nextMasterDataVersion(tx) : null;
      const location = existing
        ? await tx.location.update({
            where: { id: existing.id },
            data: { ...wanted, revision: { increment: 1 }, masterDataVersion: version },
          })
        : await tx.location.create({
            data: { code: demo.code, type: demo.type, ...wanted, masterDataVersion: version },
          });
      if (demo.type === 'plant') {
        const transit = {
          code: inTransitCode(demo.code),
          nameTh: `ระหว่างขนส่งจาก ${demo.nameTh}`,
          nameEn: `In transit from ${demo.nameEn}`,
          active: true,
        };
        await tx.location.upsert({
          where: { originId: location.id },
          create: { ...transit, type: 'in_transit', originId: location.id },
          update: transit,
        });
      }
      const snapshot = {
        id: location.id,
        locationCode: location.code,
        type: location.type,
        ...wanted,
        supersededBy: null,
      };
      if (version !== null) {
        await tx.masterDataChange.create({
          data: {
            version,
            entityType: 'location',
            entityId: location.id,
            entityCode: location.code,
            action: existing ? MasterDataAction.updated : MasterDataAction.created,
            data: { ...snapshot, version: Number(version) } as Prisma.InputJsonValue,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
          entityType: 'Location',
          entityId: location.id,
          summary: `Demo seed ${existing ? 'restored' : 'created'} ${location.type} ${location.code}`,
          changes: snapshot as Prisma.InputJsonValue,
        },
      });
      changed += 1;
    });
  }
  return changed;
}

/** Creates the two suppliers, or puts back what an evaluator changed. */
async function seedSuppliers(prisma: PrismaClient): Promise<void> {
  for (const demo of DEMO_SUPPLIERS) {
    const { code, ...wanted } = demo;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.supplier.findUnique({ where: { code } });
      const same =
        existing &&
        existing.active &&
        Object.entries(wanted).every(([k, v]) => existing[k as keyof typeof wanted] === v);
      if (same) return;
      const supplier = existing
        ? await tx.supplier.update({
            where: { id: existing.id },
            data: { ...wanted, active: true, revision: { increment: 1 } },
          })
        : await tx.supplier.create({ data: { code, ...wanted } });
      await tx.auditLog.create({
        data: {
          action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
          entityType: 'Supplier',
          entityId: supplier.id,
          summary: `Demo seed ${existing ? 'restored' : 'created'} supplier ${code}`,
          changes: { supplierCode: code, ...wanted } as Prisma.InputJsonValue,
        },
      });
    });
  }
}

/**
 * Posts the demo opening balance through the same services the API uses, as the demo plant
 * user. Once: a plant that already has an opening balance (posted, reversed or still a draft)
 * is left as it is. Returns its number, or null when there was one already.
 */
async function seedOpeningBalance(prisma: PrismaClient): Promise<string | null> {
  const plant = await prisma.location.findUniqueOrThrow({
    where: { code: DEMO_OPENING_BALANCE.locationCode },
  });
  if (await prisma.openingBalance.findFirst({ where: { locationId: plant.id } })) return null;

  const plantUser = await prisma.user.findUniqueOrThrow({
    where: { email: DEMO_USERS.find((u) => u.role === 'plant')!.email },
  });
  const actor = {
    userId: plantUser.id,
    email: plantUser.email,
    displayName: plantUser.displayName,
    roles: ['plant' as const],
    permissions: [],
    sessionId: 'demo-seed',
  };
  const items = await prisma.item.findMany({
    where: { code: { in: DEMO_OPENING_BALANCE.lines.map((l) => l.itemCode) } },
  });
  const itemId = (code: string) => items.find((i) => i.code === code)!.id;

  const { ledger, openingBalances } = ledgerServices(prisma, { quiet: true });
  const today = ledger.today();
  const draft = await openingBalances.create(
    {
      locationId: plant.id,
      businessDate: addDays(today, -1),
      note: DEMO_OPENING_BALANCE.note,
      lines: DEMO_OPENING_BALANCE.lines.map((line) => ({
        itemId: itemId(line.itemCode),
        quantity: line.quantity,
        secondaryQuantity: 'secondaryQuantity' in line ? line.secondaryQuantity : null,
        unitCost: line.unitCost,
        expiryDate: addDays(today, line.expiresInDays),
      })),
    },
    actor,
  );
  const posted = await openingBalances.post(draft.id, { revision: draft.revision }, actor);
  return `${posted.number} (${posted.lines.length} lots, value ${posted.totalValue})`;
}

async function main(): Promise<void> {
  const refusal = seedRefusal({ erpDemo: process.env.ERP_DEMO, nodeEnv: process.env.NODE_ENV });
  if (refusal) throw new SeedRefused(`${refusal}\nNothing has been written.`);

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
    const changedLocations = await seedLocations(prisma);
    console.log(
      `Demo sites ready: ${DEMO_LOCATIONS.map((l) => l.code).join(', ')}` +
        (changedLocations === 0 ? ' (already as described)' : ` (${changedLocations} written)`),
    );
    await seedSuppliers(prisma);
    console.log(`Demo suppliers ready: ${DEMO_SUPPLIERS.map((s) => s.code).join(', ')}`);
    const changedItems = await seedItems(prisma);
    console.log(
      changedItems === 0
        ? `Demo items ready: ${DEMO_ITEMS.length}, already as described (no new master data version)`
        : `Demo items ready: ${DEMO_ITEMS.length}, ${changedItems} created or put back (one master data version each)`,
    );
    const openingBalance = await seedOpeningBalance(prisma);
    console.log(
      openingBalance
        ? `Demo opening balance posted at ${DEMO_OPENING_BALANCE.locationCode}: ${openingBalance}`
        : `Demo opening balance at ${DEMO_OPENING_BALANCE.locationCode}: already there, left as it is`,
    );
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

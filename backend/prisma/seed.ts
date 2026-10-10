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
 * branches and two suppliers (#6), the plant's opening balance (#7) and one approved write-off
 * (#8), purchase orders (#10), goods receipts (#11) and production BOMs (#12); later tickets extend
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
import {
  allocationRatios,
  bomFigures,
  bomIssues,
  type BomItemFacts,
} from '../src/modules/production-boms/domain/bom-rules';
import { ledgerServices } from './ledger-services';

import {
  DEMO_COMPANY,
  DEMO_ITEMS,
  DEMO_LOCATIONS,
  DEMO_MENU_ITEMS,
  DEMO_MFA_SECRET,
  DEMO_MODIFIER_GROUPS,
  DEMO_OPENING_BALANCE,
  DEMO_PASSWORD,
  DEMO_RECOVERY_CODES,
  DEMO_SUPPLIERS,
  DEMO_USERS,
  DEMO_WRITE_OFF,
  DEMO_GOODS_RECEIPTS,
  DEMO_PURCHASE_APPROVAL_THRESHOLD,
  DEMO_PURCHASE_ORDERS,
  DEMO_PRODUCTION_BOMS,
  DEMO_PRODUCTION_ORDER,
  DEMO_ARRIVAL_TEMPERATURE,
  DEMO_TRANSFERS,
  DEMO_RECEIVING_TOLERANCES,
  type DemoRecipeVersion,
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

/** A demo user as the services see the person acting. */
async function demoActor(
  prisma: PrismaClient,
  role:
    | 'plant'
    | 'finance'
    | 'admin'
    | 'purchasing'
    | 'purchasing_approver'
    | 'logistics'
    | 'branch_manager',
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: DEMO_USERS.find((u) => u.role === role)!.email },
  });
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: [role],
    permissions: [],
    sessionId: 'demo-seed',
  };
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

  const actor = await demoActor(prisma, 'plant');
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

/**
 * The approved write-off (#8): raised and submitted by the plant user, approved — and so
 * posted — by the finance user, through the same service the API runs. Once: a plant that
 * already has a stock adjustment is left as it is. Returns its number, or null.
 */
async function seedWriteOff(prisma: PrismaClient): Promise<string | null> {
  const plant = await prisma.location.findUniqueOrThrow({
    where: { code: DEMO_WRITE_OFF.locationCode },
  });
  if (await prisma.stockAdjustment.findFirst({ where: { locationId: plant.id } })) return null;
  const opening = await prisma.openingBalance.findFirst({ where: { locationId: plant.id } });
  const lot = opening
    ? await prisma.lot.findFirst({
        where: {
          originDocumentId: opening.documentId,
          originLineNo: DEMO_WRITE_OFF.openingBalanceLineNo,
        },
      })
    : null;
  // The opening balance was left as someone changed it: nothing known to write off.
  if (!lot) return null;

  const { stockAdjustments } = ledgerServices(prisma, { quiet: true });
  const raiser = await demoActor(prisma, 'plant');
  const approver = await demoActor(prisma, 'finance');
  const draft = await stockAdjustments.create(
    {
      locationId: plant.id,
      note: DEMO_WRITE_OFF.note,
      lines: [
        {
          lotId: lot.id,
          quantity: DEMO_WRITE_OFF.quantity,
          secondaryQuantity: DEMO_WRITE_OFF.secondaryQuantity,
          reason: DEMO_WRITE_OFF.reason,
        },
      ],
    },
    raiser,
  );
  const submitted = await stockAdjustments.submit(draft.id, { revision: draft.revision }, raiser);
  const approved = await stockAdjustments.approve(
    submitted.id,
    { revision: submitted.revision },
    approver,
    {},
  );
  if (approved.postingRefusal) {
    throw new Error(`The demo write-off was not posted: ${approved.postingRefusal.message}`);
  }
  return `${approved.number} (lot ${lot.number}, ${DEMO_WRITE_OFF.quantity} kg, value ${approved.totalValue})`;
}

/**
 * The demo company's purchase approval threshold (#10), set by the admin through the same
 * service the API runs, unless an evaluator has already set one. Returns the threshold in force.
 */
async function seedApprovalThreshold(prisma: PrismaClient): Promise<string> {
  const { company } = ledgerServices(prisma, { quiet: true });
  const current = await company.settings();
  if (current.revision > 0) return current.purchaseApprovalThreshold;
  const admin = await demoActor(prisma, 'admin');
  const saved = await company.updateSettings(
    { revision: 0, purchaseApprovalThreshold: DEMO_PURCHASE_APPROVAL_THRESHOLD },
    admin,
    {},
  );
  return saved.purchaseApprovalThreshold;
}

/**
 * The demo purchase orders (#10), raised by the purchasing user through the same service the API
 * runs: submitted, approved by the purchasing approver when above the threshold — never by the
 * person who raised it (ADR-0008) — and marked sent, or left as a draft. Once: if any purchase
 * order exists they are left as they are. Returns their numbers and statuses.
 */
async function seedPurchaseOrders(prisma: PrismaClient): Promise<string[]> {
  if (await prisma.purchaseOrder.findFirst()) return [];
  const { purchaseOrders, ledger } = ledgerServices(prisma, { quiet: true });
  const raiser = await demoActor(prisma, 'purchasing');
  const approver = await demoActor(prisma, 'purchasing_approver');
  const today = ledger.today();
  const written: string[] = [];
  for (const demo of DEMO_PURCHASE_ORDERS) {
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { code: demo.supplierCode },
    });
    const location = await prisma.location.findUniqueOrThrow({
      where: { code: demo.locationCode },
    });
    const items = await prisma.item.findMany({
      where: { code: { in: demo.lines.map((l) => l.itemCode) } },
    });
    let order = await purchaseOrders.create(
      {
        supplierId: supplier.id,
        deliveryLocationId: location.id,
        expectedDeliveryDate: addDays(today, demo.deliveryInDays),
        note: demo.note,
        lines: demo.lines.map(({ itemCode, ...line }) => ({
          ...line,
          itemId: items.find((i) => i.code === itemCode)!.id,
        })),
      },
      raiser,
      {},
    );
    if (demo.until === 'sent') {
      order = await purchaseOrders.submit(order.id, { revision: order.revision }, raiser, {});
      if (order.status === 'submitted') {
        order = await purchaseOrders.approve(order.id, { revision: order.revision }, approver, {});
      }
      order = await purchaseOrders.send(order.id, { revision: order.revision }, raiser, {});
    }
    const how = order.approved?.automatically
      ? ', approved automatically'
      : order.approved
        ? `, approved by ${order.approved.by?.displayName}`
        : '';
    written.push(`${order.number} ${order.status}${how}, gross ${order.totals.gross}`);
  }
  return written;
}

/**
 * The demo items' receiving tolerances (#11), set by the admin through the same service the API
 * runs, or put back when an evaluator changed them. Returns how many items were written.
 */
async function seedReceivingTolerances(prisma: PrismaClient): Promise<number> {
  const { items } = ledgerServices(prisma, { quiet: true });
  const admin = await demoActor(prisma, 'admin');
  let written = 0;
  for (const [code, wanted] of Object.entries(DEMO_RECEIVING_TOLERANCES)) {
    const item = await prisma.item.findUniqueOrThrow({ where: { code } });
    const current = (await items.get(item.id)).receivingTolerances;
    if (JSON.stringify(current) === JSON.stringify(wanted)) continue;
    await items.setReceivingTolerances(item.id, wanted, admin, {});
    written += 1;
  }
  return written;
}

/**
 * The demo goods receipts (#11), received by the plant user through the same service the API
 * runs: submitted, which posts the one within tolerance; the other waits for, and is approved by,
 * the purchasing approver — never the plant user who received it (ADR-0008). Once: if any goods
 * receipt exists, or the demo orders were changed so they no longer receive, they are left as
 * they are. Returns their numbers and outcomes.
 */
async function seedGoodsReceipts(prisma: PrismaClient): Promise<string[]> {
  if (await prisma.goodsReceipt.findFirst()) return [];
  const { goodsReceipts, ledger } = ledgerServices(prisma, { quiet: true });
  const receiver = await demoActor(prisma, 'plant');
  const approver = await demoActor(prisma, 'purchasing_approver');
  const today = ledger.today();
  const orders = await prisma.purchaseOrder.findMany({
    where: { note: { in: DEMO_PURCHASE_ORDERS.map((o) => o.note) } },
  });
  const written: string[] = [];
  for (const demo of DEMO_GOODS_RECEIPTS) {
    const order = orders.find((o) => o.note === DEMO_PURCHASE_ORDERS[demo.purchaseOrderIndex].note);
    if (!order || !['approved', 'sent', 'partially_received'].includes(order.status)) continue;
    const draft = await goodsReceipts.create(
      {
        purchaseOrderId: order.id,
        note: demo.note,
        lines: demo.lines.map(({ supplierExpiresInDays, ...line }) => ({
          ...line,
          supplierExpiry:
            supplierExpiresInDays === null ? null : addDays(today, supplierExpiresInDays),
        })),
      },
      receiver,
      {},
    );
    let receipt = await goodsReceipts.submit(draft.id, { revision: draft.revision }, receiver, {});
    if (receipt.status === 'submitted') {
      receipt = await goodsReceipts.approve(
        receipt.id,
        { revision: receipt.revision },
        approver,
        {},
      );
    }
    if (receipt.postingRefusal || receipt.status !== 'posted') {
      throw new Error(
        `The demo goods receipt ${receipt.number} was not posted: ${receipt.postingRefusal?.message ?? receipt.status}`,
      );
    }
    const how = receipt.approved
      ? `findings approved by ${receipt.approved.by.displayName}`
      : 'within tolerance';
    const returned = receipt.supplierReturn ? `, ${receipt.supplierReturn.number} returned` : '';
    written.push(`${receipt.number} posted against ${order.number}, ${how}${returned}`);
  }
  return written;
}

/**
 * Creates the demo menu (#16): modifier groups with their option recipes, then menu items with
 * their prices and recipe versions. Each one written takes a master data version and a change,
 * as the API does, so a POS pulling from version 0 sees the menu. Prices and first recipes start
 * yesterday, the day of the opening balance: a script may write that history, the API never
 * backdates. Anything already there is left as an evaluator left it, because recipe versions
 * and prices that have started are never rewritten. (Mirrors the menu services.)
 */
async function seedMenu(prisma: PrismaClient): Promise<number> {
  const { ledger } = ledgerServices(prisma, { quiet: true });
  const today = ledger.today();
  const day = (fromDay: number) => new Date(`${addDays(today, fromDay)}T00:00:00.000Z`);
  const items = await prisma.item.findMany({
    select: { id: true, code: true, baseUnitCode: true },
  });
  const itemByCode = new Map(items.map((i) => [i.code, i]));
  const branches = await prisma.location.findMany({
    where: { type: 'branch' },
    select: { id: true, code: true },
  });
  const branchByCode = new Map(branches.map((b) => [b.code, b]));
  let written = 0;

  const change = async (
    tx: Prisma.TransactionClient,
    version: bigint,
    entityType: string,
    entityId: string,
    entityCode: string,
    data: Record<string, unknown>,
    audit: { entityType: string; summary: string },
  ) => {
    await tx.masterDataChange.create({
      data: {
        version,
        entityType,
        entityId,
        entityCode,
        action: MasterDataAction.created,
        data: { ...data, version: Number(version) } as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        action: AuditAction.CREATE,
        entityType: audit.entityType,
        entityId,
        summary: `Demo seed created ${audit.summary}`,
        changes: data as Prisma.InputJsonValue,
      },
    });
    written += 1;
  };

  const recipes = async (
    tx: Prisma.TransactionClient,
    subject: { menuItemId: string } | { modifierOptionId: string },
    entityType: 'menu_recipe' | 'modifier_recipe',
    subjectCode: Record<string, string>,
    versions: readonly DemoRecipeVersion[],
  ) => {
    for (const [index, demo] of versions.entries()) {
      const version = await nextMasterDataVersion(tx);
      const row = await tx.recipeVersion.create({
        data: {
          ...subject,
          number: index + 1,
          effectiveFrom: day(demo.fromDay),
          version,
          lines: {
            create: demo.lines.map(([itemCode, quantity], i) => ({
              lineNo: i + 1,
              itemId: itemByCode.get(itemCode)!.id,
              quantity,
            })),
          },
        },
      });
      const code = subjectCode.menuItemCode ?? subjectCode.modifierCode;
      await change(
        tx,
        version,
        entityType,
        row.id,
        code,
        {
          id: row.id,
          ...subjectCode,
          number: row.number,
          effectiveFrom: addDays(today, demo.fromDay),
          lines: demo.lines.map(([itemCode, quantity]) => ({
            itemCode,
            quantity,
            unitCode: itemByCode.get(itemCode)!.baseUnitCode,
          })),
        },
        {
          entityType: 'RecipeVersion',
          summary: `version ${row.number} of the recipe for ${code}`,
        },
      );
    }
  };

  for (const demo of DEMO_MODIFIER_GROUPS) {
    if (await prisma.modifierGroup.findUnique({ where: { code: demo.code } })) continue;
    await prisma.$transaction(async (tx) => {
      const version = await nextMasterDataVersion(tx);
      const group = await tx.modifierGroup.create({
        data: {
          code: demo.code,
          nameTh: demo.nameTh,
          nameEn: demo.nameEn,
          minSelections: demo.minSelections,
          maxSelections: demo.maxSelections,
          version,
          options: {
            create: demo.options.map((o, position) => ({
              code: o.code,
              nameTh: o.nameTh,
              nameEn: o.nameEn,
              priceChange: o.priceChange,
              position,
            })),
          },
        },
        include: { options: true },
      });
      await change(
        tx,
        version,
        'modifier_group',
        group.id,
        group.code,
        {
          id: group.id,
          groupCode: group.code,
          nameTh: group.nameTh,
          nameEn: group.nameEn,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          active: true,
          options: demo.options.map((o) => ({
            modifierCode: o.code,
            nameTh: o.nameTh,
            nameEn: o.nameEn,
            priceChange: o.priceChange,
            active: true,
          })),
        },
        { entityType: 'ModifierGroup', summary: `modifier group ${group.code} (${group.nameEn})` },
      );
      for (const option of demo.options) {
        const row = group.options.find((o) => o.code === option.code)!;
        await recipes(
          tx,
          { modifierOptionId: row.id },
          'modifier_recipe',
          { modifierCode: option.code },
          option.recipes,
        );
      }
    });
  }

  const groups = await prisma.modifierGroup.findMany({ select: { id: true, code: true } });
  const groupByCode = new Map(groups.map((g) => [g.code, g]));
  for (const demo of DEMO_MENU_ITEMS) {
    if (await prisma.menuItem.findUnique({ where: { code: demo.code } })) continue;
    await prisma.$transaction(async (tx) => {
      const version = await nextMasterDataVersion(tx);
      const item = await tx.menuItem.create({
        data: {
          code: demo.code,
          nameTh: demo.nameTh,
          nameEn: demo.nameEn,
          categoryTh: demo.categoryTh,
          categoryEn: demo.categoryEn,
          soldBy: demo.soldBy,
          version,
          modifierGroups: {
            create: demo.modifierGroupCodes.map((code, position) => ({
              groupId: groupByCode.get(code)!.id,
              position,
            })),
          },
        },
      });
      await change(
        tx,
        version,
        'menu_item',
        item.id,
        item.code,
        {
          id: item.id,
          menuItemCode: item.code,
          nameTh: item.nameTh,
          nameEn: item.nameEn,
          categoryTh: item.categoryTh,
          categoryEn: item.categoryEn,
          soldBy: item.soldBy,
          active: true,
          modifierGroupCodes: demo.modifierGroupCodes,
        },
        { entityType: 'MenuItem', summary: `menu item ${item.code} (${item.nameEn})` },
      );
      for (const price of demo.prices) {
        const priceVersion = await nextMasterDataVersion(tx);
        const row = await tx.menuPrice.create({
          data: {
            menuItemId: item.id,
            locationId: price.locationCode ? branchByCode.get(price.locationCode)!.id : null,
            effectiveFrom: day(price.fromDay),
            price: price.price,
            version: priceVersion,
          },
        });
        await change(
          tx,
          priceVersion,
          'menu_price',
          row.id,
          item.code,
          {
            id: row.id,
            menuItemCode: item.code,
            locationCode: price.locationCode,
            effectiveFrom: addDays(today, price.fromDay),
            price: price.price,
          },
          {
            entityType: 'MenuPrice',
            summary: `the ${price.locationCode ?? 'chain-wide'} price of ${item.code}`,
          },
        );
      }
      await recipes(
        tx,
        { menuItemId: item.id },
        'menu_recipe',
        { menuItemCode: item.code, per: demo.soldBy === 'weight' ? 'kg' : 'portion' },
        demo.recipes,
      );
    });
  }
  return written;
}

/**
 * Creates the demo production BOMs (#12): one version each, from yesterday, with the ratios the
 * API would store (the override when given, else the weight shares). A script may write that
 * history; the API never backdates. A BOM already there is left as an evaluator left it.
 */
async function seedProductionBoms(prisma: PrismaClient): Promise<string[]> {
  const { ledger } = ledgerServices(prisma, { quiet: true });
  const today = ledger.today();
  const rows = await prisma.item.findMany({
    select: { id: true, code: true, active: true, baseUnitCode: true, baseUnit: true },
  });
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const facts = new Map<string, BomItemFacts>(
    rows.map((r) => [
      r.id,
      { active: r.active, baseUnitCode: r.baseUnitCode, baseUnitDecimals: r.baseUnit.decimals },
    ]),
  );
  const written: string[] = [];
  for (const demo of DEMO_PRODUCTION_BOMS) {
    if (await prisma.productionBom.findUnique({ where: { code: demo.code } })) continue;
    const line = (l: (typeof demo.inputs)[number]) => ({
      itemId: byCode.get(l.itemCode)!.id,
      quantity: l.quantity,
      expectedWeightKg: l.expectedWeightKg ?? null,
      allocationRatio: l.allocationRatio ?? null,
    });
    const inputs = demo.inputs.map(line);
    const outputs = demo.outputs.map(line);
    const issues = bomIssues(inputs, outputs, facts);
    if (issues.lines.length > 0 || issues.problems.length > 0) {
      throw new Error(`Demo BOM ${demo.code} is invalid: ${JSON.stringify(issues)}`);
    }
    const ratios = allocationRatios(outputs, bomFigures(inputs, outputs, facts).outputWeights);
    const effectiveFrom = addDays(today, demo.fromDay);
    await prisma.$transaction(async (tx) => {
      const bom = await tx.productionBom.create({
        data: {
          code: demo.code,
          nameTh: demo.nameTh,
          nameEn: demo.nameEn,
          locationType: 'plant',
          versions: {
            create: {
              number: 1,
              effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
              ratiosOverridden: ratios.overridden,
              lines: {
                create: [
                  ...inputs.map((l, i) => ({
                    side: 'input' as const,
                    lineNo: i + 1,
                    itemId: l.itemId,
                    quantity: l.quantity,
                    expectedWeightKg: l.expectedWeightKg,
                  })),
                  ...outputs.map((l, i) => ({
                    side: 'output' as const,
                    lineNo: i + 1,
                    itemId: l.itemId,
                    quantity: l.quantity,
                    expectedWeightKg: l.expectedWeightKg,
                    allocationRatio: ratios.ratios[i],
                  })),
                ],
              },
            },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entityType: 'ProductionBom',
          entityId: bom.id,
          summary: `Demo seed created production BOM ${demo.code} (${demo.nameEn}), version 1 from ${effectiveFrom}`,
          changes: {
            bomCode: demo.code,
            ratiosOverridden: ratios.overridden,
            ratios: ratios.ratios,
          } as Prisma.InputJsonValue,
        },
      });
    });
    written.push(`${demo.code} (${ratios.ratios.join(' / ')} %)`);
  }
  return written;
}

/**
 * The demo cutting order (#13): drafted, released (lots picked FEFO), recorded and posted by the
 * plant user through the same service the API runs. Once: if any production order exists, they
 * are left as they are. Returns its number and yield, or null.
 */
async function seedProductionOrder(prisma: PrismaClient): Promise<string | null> {
  if (await prisma.productionOrder.findFirst()) return null;
  const demo = DEMO_PRODUCTION_ORDER;
  const bom = await prisma.productionBom.findUnique({ where: { code: demo.bomCode } });
  const plant = await prisma.location.findUniqueOrThrow({ where: { code: demo.locationCode } });
  if (!bom) return null;
  const { productionOrders } = ledgerServices(prisma, { quiet: true });
  const plantUser = await demoActor(prisma, 'plant');
  const draft = await productionOrders.create(
    { bomId: bom.id, locationId: plant.id, plannedQuantity: demo.plannedQuantity, note: demo.note },
    plantUser,
    {},
  );
  const released = await productionOrders.release(
    draft.id,
    { revision: draft.revision },
    plantUser,
    {},
  );
  const picks = released.inputs[0].picks;
  if (picks.length !== demo.piecesPerPick.length || released.inputs[0].shortBy !== '0') {
    throw new Error(
      `The demo cutting order picked ${picks.length} lots short by ${released.inputs[0].shortBy}; the demo expects ${demo.piecesPerPick.length} covering it`,
    );
  }
  const recorded = await productionOrders.recordActuals(
    draft.id,
    {
      revision: released.revision,
      inputs: [
        {
          lineNo: 1,
          picks: picks.map((p, i) => ({
            lotId: p.lotId,
            quantity: p.quantity,
            pieces: demo.piecesPerPick[i],
          })),
        },
      ],
      outputs: demo.outputs.map((o, i) => ({ lineNo: i + 1, ...o })),
    },
    plantUser,
    {},
  );
  const posted = await productionOrders.post(
    draft.id,
    { revision: recorded.revision },
    plantUser,
    {},
  );
  return `${posted.number} posted: ${posted.inputs[0].quantity} kg in, yield ${posted.yield.actual} % against ${posted.yield.expected} %`;
}

/**
 * Dispatches and receives the demo transfers (#14) through the same services the API uses:
 * logistics confirms the lots FEFO suggests, the branch manager records what arrived, and the plant
 * approves the receipts with a finding or a write-off. Once: an installation with any transfer
 * is left as it is. Returns a line per transfer, or an empty list when there were some already.
 */
async function seedTransfers(prisma: PrismaClient): Promise<string[]> {
  if (await prisma.transfer.findFirst()) return [];
  const plant = await prisma.location.findUniqueOrThrow({
    where: { code: DEMO_PRODUCTION_ORDER.locationCode },
  });
  const { transfers, transferReceipts } = ledgerServices(prisma, { quiet: true });
  const [logistics, manager, plantUser] = await Promise.all([
    demoActor(prisma, 'logistics'),
    demoActor(prisma, 'branch_manager'),
    demoActor(prisma, 'plant'),
  ]);
  const items = new Map(
    (await prisma.item.findMany({ select: { id: true, code: true } })).map((i) => [i.code, i.id]),
  );
  const summaries: string[] = [];
  for (const demo of DEMO_TRANSFERS) {
    const destination = await prisma.location.findUniqueOrThrow({
      where: { code: demo.destinationCode },
    });
    const draft = await transfers.create(
      {
        originId: plant.id,
        destinationId: destination.id,
        note: demo.note,
        lines: demo.lines.map((l) => ({ itemId: items.get(l.itemCode)!, quantity: l.quantity })),
      },
      logistics,
      {},
    );
    if (draft.blockers.length > 0 || draft.lines.some((l) => l.shortBy !== '0')) {
      throw new Error(
        `The demo transfer to ${demo.destinationCode} cannot be filled from ${plant.code}: ${JSON.stringify(draft.blockers)}`,
      );
    }
    const dispatched = await transfers.dispatch(
      draft.id,
      {
        revision: draft.revision,
        picks: draft.lines.flatMap((l) =>
          l.picks.map((p) => ({
            lineNo: l.lineNo,
            lotId: p.lotId,
            quantity: p.quantity,
            pieces: p.pieces,
          })),
        ),
      },
      logistics,
      {},
    );
    const receipt = await transferReceipts.create(
      dispatched.id,
      {
        lines: dispatched.lines.flatMap((line) =>
          line.picks.map((pick) => {
            const arrival = demo.arrivals[line.item.code];
            const received = arrival?.received ?? pick.quantity;
            return {
              lineNo: pick.pickNo!,
              received,
              temperature: arrival?.temperature ?? DEMO_ARRIVAL_TEMPERATURE,
              condition: 'good',
              accepted: received,
              returned: '0',
              writtenOff: arrival?.writtenOff ?? '0',
              reason: arrival?.reason ?? null,
            };
          }),
        ),
      },
      manager,
      {},
    );
    let posted = await transferReceipts.submit(
      receipt.id,
      { revision: receipt.revision },
      manager,
      {},
    );
    if (posted.status === 'submitted') {
      posted = await transferReceipts.approve(
        receipt.id,
        { revision: posted.revision },
        plantUser,
        {},
      );
    }
    if (posted.status !== 'posted') {
      throw new Error(
        `The demo receipt ${posted.number} did not post: ${JSON.stringify(posted.blockers)}`,
      );
    }
    summaries.push(
      `${dispatched.number} to ${demo.destinationCode} received by ${posted.number}` +
        (posted.approved ? ', approved by the plant' : ''),
    );
  }
  return summaries;
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
    const menuWritten = await seedMenu(prisma);
    console.log(
      `Demo menu ready: ${DEMO_MENU_ITEMS.length} menu items, ${DEMO_MODIFIER_GROUPS.length} modifier groups` +
        (menuWritten === 0
          ? ' (already there, left as it is)'
          : ` (${menuWritten} records written)`),
    );
    const openingBalance = await seedOpeningBalance(prisma);
    console.log(
      openingBalance
        ? `Demo opening balance posted at ${DEMO_OPENING_BALANCE.locationCode}: ${openingBalance}`
        : `Demo opening balance at ${DEMO_OPENING_BALANCE.locationCode}: already there, left as it is`,
    );
    const writeOff = await seedWriteOff(prisma);
    console.log(
      writeOff
        ? `Demo write-off approved and posted at ${DEMO_WRITE_OFF.locationCode}: ${writeOff}`
        : `Demo write-off at ${DEMO_WRITE_OFF.locationCode}: already there, left as it is`,
    );
    const threshold = await seedApprovalThreshold(prisma);
    console.log(`Demo purchase approval threshold: ${threshold}`);
    const orders = await seedPurchaseOrders(prisma);
    console.log(
      orders.length > 0
        ? `Demo purchase orders: ${orders.join('; ')}`
        : 'Demo purchase orders: already there, left as they are',
    );
    const tolerances = await seedReceivingTolerances(prisma);
    console.log(
      `Demo receiving tolerances: ${Object.keys(DEMO_RECEIVING_TOLERANCES).length} items` +
        (tolerances === 0 ? ' (already as described)' : ` (${tolerances} written)`),
    );
    const receipts = await seedGoodsReceipts(prisma);
    console.log(
      receipts.length > 0
        ? `Demo goods receipts: ${receipts.join('; ')}`
        : 'Demo goods receipts: already there, left as they are',
    );
    const boms = await seedProductionBoms(prisma);
    console.log(
      boms.length > 0
        ? `Demo production BOMs: ${boms.join('; ')}`
        : 'Demo production BOMs: already there, left as they are',
    );
    const productionOrder = await seedProductionOrder(prisma);
    console.log(
      productionOrder
        ? `Demo production order: ${productionOrder}`
        : 'Demo production order: already there, left as it is',
    );
    const transfers = await seedTransfers(prisma);
    console.log(
      transfers.length > 0
        ? `Demo transfers: ${transfers.join('; ')}`
        : 'Demo transfers: already there, left as they are',
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

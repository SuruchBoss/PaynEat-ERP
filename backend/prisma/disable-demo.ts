// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Disables every demo seed account (#5): the documented way out when a production API
 * refuses to start because accounts with a published password are enabled.
 *
 *     npm run demo:disable                                         # in backend/
 *     docker compose run --rm migrate npm run demo:disable         # with docker compose
 *
 * Users are never deleted, only disabled: their audit history keeps its actor. Their
 * sessions end too. Safe to run any number of times; running the demo seed again (with
 * ERP_DEMO=1) turns the accounts back on.
 */
import 'dotenv/config';
import { AuditAction, PrismaClient, UserStatus } from '@prisma/client';

export async function disableDemoAccounts(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const accounts = await tx.user.findMany({
      where: { demo: true, status: UserStatus.ACTIVE },
      select: { id: true },
    });
    if (accounts.length === 0) return 0;

    const ids = accounts.map((a) => a.id);
    const now = new Date();
    await tx.user.updateMany({ where: { id: { in: ids } }, data: { status: UserStatus.DISABLED } });
    await tx.session.updateMany({
      where: { userId: { in: ids }, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'DEMO_DISABLED' },
    });
    await tx.auditLog.createMany({
      data: ids.map((id) => ({
        actorUserId: null,
        action: AuditAction.UPDATE,
        entityType: 'User',
        entityId: id,
        summary: 'Demo account disabled (npm run demo:disable)',
        changes: { status: { from: UserStatus.ACTIVE, to: UserStatus.DISABLED } },
      })),
    });
    return ids.length;
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const disabled = await disableDemoAccounts(prisma);
    console.log(
      disabled === 0
        ? 'No enabled demo accounts: nothing to do.'
        : `Disabled ${disabled} demo account${disabled === 1 ? '' : 's'} and ended their sessions.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

/**
 * Demo seed: builds the fictional fried-chicken chain on an empty database.
 *
 * Evaluation only — never a real installation. The chain is invented and refers
 * to no real company (CLAUDE.md). For now it creates only the company; later
 * tickets extend it with the plant, three branches, two suppliers, items and the
 * whole supplier-to-plate path, so that one command still builds everything.
 *
 * Safe to re-run: every write is an upsert keyed on a natural key.
 * Structure adapted from Cwork's prisma/seed.ts (see NOTICE).
 */
import { PrismaClient } from '@prisma/client';

export const DEMO_COMPANY = {
  code: 'DEMO-CHICKEN',
  name: 'PaynEat Demo Fried Chicken Co., Ltd. (fictional)',
  nameTh: 'บริษัท เพย์นอีท เดโม ไก่ทอด จำกัด (สมมติ)',
} as const;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.upsert({
      where: { code: DEMO_COMPANY.code },
      update: { name: DEMO_COMPANY.name, nameTh: DEMO_COMPANY.nameTh },
      create: { ...DEMO_COMPANY },
    });
    console.log(`Demo company ready: ${company.code} — ${company.name}`);
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

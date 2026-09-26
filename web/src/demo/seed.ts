// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The fictional fried-chicken chain the demo starts from (#41, ADR-0021): the very data the
 * backend's demo seed builds, imported from `backend/prisma/demo-data.ts`, so the two cannot
 * drift apart. Everything in it is invented and refers to no real company, and every
 * credential is the one README publishes.
 */
export {
  DEMO_ITEMS,
  DEMO_LOCATIONS,
  DEMO_MFA_SECRET,
  DEMO_OPENING_BALANCE,
  DEMO_PASSWORD,
  DEMO_RECOVERY_CODES,
  DEMO_SUPPLIERS,
  DEMO_USERS,
} from '@backend/prisma/demo-data';

/**
 * The unit catalogue every installation ships with. The backend creates it in a migration
 * (#5), which a browser cannot import; `seed.test.ts` reads that migration and fails if the
 * two ever differ.
 */
export const UNITS = [
  { code: 'bag', nameTh: 'ถุง', nameEn: 'bag', decimals: 0 },
  { code: 'bottle', nameTh: 'ขวด', nameEn: 'bottle', decimals: 0 },
  { code: 'box', nameTh: 'กล่อง', nameEn: 'box', decimals: 0 },
  { code: 'case', nameTh: 'ลัง', nameEn: 'case', decimals: 0 },
  { code: 'g', nameTh: 'กรัม', nameEn: 'gram', decimals: 0 },
  { code: 'kg', nameTh: 'กิโลกรัม', nameEn: 'kilogram', decimals: 3 },
  { code: 'l', nameTh: 'ลิตร', nameEn: 'litre', decimals: 3 },
  { code: 'ml', nameTh: 'มิลลิลิตร', nameEn: 'millilitre', decimals: 0 },
  { code: 'pack', nameTh: 'แพ็ก', nameEn: 'pack', decimals: 0 },
  { code: 'piece', nameTh: 'ชิ้น', nameEn: 'piece', decimals: 0 },
  { code: 'sack', nameTh: 'กระสอบ', nameEn: 'sack', decimals: 0 },
  { code: 'tin', nameTh: 'ปี๊บ', nameEn: 'tin', decimals: 0 },
  { code: 'tray', nameTh: 'ถาด', nameEn: 'tray', decimals: 0 },
] as const;

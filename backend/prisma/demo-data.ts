// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The demo chain's data: the fictional fried-chicken company, its accounts, items, sites,
 * suppliers and opening stock. Pure data with no imports but a type, so the demo seed
 * (`seed.ts`) and the console's public demo (web/src/demo, ADR-0021) build the very same
 * chain. Everything here is invented and refers to no real company (CLAUDE.md), and every
 * credential is published in this repository: EVALUATION ONLY.
 */
import type { Role } from '../src/core/security/permissions';

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
  role: Role;
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

export interface DemoItem {
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
  shelfLifeDays: number;
  purchaseUnits: Array<{ unitCode: string; factor: string }>;
}

/**
 * The chain's items (#5): whole birds bought by the case and weighed, the pieces the
 * plant cuts them into, the frame left over, and what the branches fry them in. Codes
 * and figures follow the ExcelToGo draft template (docs/integrations/exceltogo).
 */
export const DEMO_ITEMS: readonly DemoItem[] = [
  {
    code: 'WHOLE-CHICKEN',
    nameTh: 'ไก่ทั้งตัว',
    nameEn: 'Whole chicken',
    baseUnitCode: 'kg',
    variableWeight: true,
    shelfLifeDays: 5,
    purchaseUnits: [{ unitCode: 'case', factor: '20' }],
  },
  ...(
    [
      ['CHICKEN-BREAST', 'อกไก่', 'Chicken breast'],
      ['CHICKEN-THIGH', 'สะโพกไก่', 'Chicken thigh'],
      ['CHICKEN-DRUMSTICK', 'น่องไก่', 'Chicken drumstick'],
      ['CHICKEN-WING', 'ปีกไก่', 'Chicken wing'],
    ] as const
  ).map(([code, nameTh, nameEn]) => ({
    code,
    nameTh,
    nameEn,
    baseUnitCode: 'piece',
    variableWeight: false,
    shelfLifeDays: 4,
    purchaseUnits: [],
  })),
  {
    code: 'CHICKEN-FRAME',
    nameTh: 'โครงไก่',
    nameEn: 'Chicken frame',
    baseUnitCode: 'kg',
    variableWeight: true,
    shelfLifeDays: 3,
    purchaseUnits: [],
  },
  {
    code: 'FLOUR',
    nameTh: 'แป้งชุบทอด',
    nameEn: 'Batter flour',
    baseUnitCode: 'kg',
    variableWeight: false,
    shelfLifeDays: 180,
    purchaseUnits: [{ unitCode: 'bag', factor: '25' }],
  },
  {
    code: 'FRYING-OIL',
    nameTh: 'น้ำมันทอด',
    nameEn: 'Frying oil',
    baseUnitCode: 'l',
    variableWeight: false,
    shelfLifeDays: 365,
    purchaseUnits: [{ unitCode: 'tin', factor: '18' }],
  },
  {
    code: 'SEASONING',
    nameTh: 'ผงปรุงรส',
    nameEn: 'Seasoning',
    baseUnitCode: 'kg',
    variableWeight: false,
    shelfLifeDays: 365,
    purchaseUnits: [{ unitCode: 'bag', factor: '5' }],
  },
];

/**
 * The chain's sites (#6): one plant that cuts and marinates, three branches. Codes follow
 * the ExcelToGo draft template. The plant's in-transit location is created with it.
 */
export const DEMO_LOCATIONS = [
  { code: 'PLANT-01', type: 'plant', nameTh: 'โรงงานบางนา', nameEn: 'Bang Na plant' },
  { code: 'BR-SILOM', type: 'branch', nameTh: 'สาขาสีลม', nameEn: 'Silom branch' },
  { code: 'BR-ARI', type: 'branch', nameTh: 'สาขาอารีย์', nameEn: 'Ari branch' },
  { code: 'BR-BANGNA', type: 'branch', nameTh: 'สาขาบางนา', nameEn: 'Bang Na branch' },
] as const;

/**
 * Two fictional suppliers: fresh chicken, and everything dry. Their tax ids start with
 * twelve zeros, a range no real taxpayer is given, and pass the check digit; their phone
 * numbers and addresses are invented too.
 */
export const DEMO_SUPPLIERS = [
  {
    code: 'SUP-CHICKEN',
    name: 'บริษัท ฟาร์มไก่เดโม จำกัด (สมมติ) · Demo Chicken Farm Co., Ltd. (fictional)',
    taxId: '0000000000001',
    contactName: 'ฝ่ายขาย (สมมติ)',
    phone: '02-000-0001',
    email: 'sales@chicken-farm.example',
    address: 'ถนนสมมติ 1 จังหวัดตัวอย่าง (ที่อยู่สมมติ)',
  },
  {
    code: 'SUP-DRYGOODS',
    name: 'บริษัท วัตถุดิบเดโม จำกัด (สมมติ) · Demo Dry Goods Co., Ltd. (fictional)',
    taxId: '0000000000027',
    contactName: 'ฝ่ายขาย (สมมติ)',
    phone: '02-000-0002',
    email: 'sales@dry-goods.example',
    address: 'ถนนสมมติ 2 จังหวัดตัวอย่าง (ที่อยู่สมมติ)',
  },
] as const;

/**
 * The stock the plant held when it started using the ERP (#7), posted as one opening balance
 * dated yesterday, so "stock as of" the day before shows nothing and yesterday shows it all.
 * Flour and oil for months; whole chickens in three lots that expire on different days, each
 * weighed with its bird count. Expiry dates count from the day the seed first runs; costs are
 * invented.
 */
export const DEMO_OPENING_BALANCE = {
  locationCode: 'PLANT-01',
  note: 'Demo seed: stock on hand at go-live (fictional)',
  lines: [
    { itemCode: 'FLOUR', quantity: '250.000', unitCost: '32.5', expiresInDays: 150 },
    { itemCode: 'FRYING-OIL', quantity: '180.000', unitCost: '48', expiresInDays: 300 },
    {
      itemCode: 'WHOLE-CHICKEN',
      quantity: '21.600',
      secondaryQuantity: '12',
      unitCost: '72.5',
      expiresInDays: 1,
    },
    {
      itemCode: 'WHOLE-CHICKEN',
      quantity: '43.200',
      secondaryQuantity: '24',
      unitCost: '71',
      expiresInDays: 2,
    },
    {
      itemCode: 'WHOLE-CHICKEN',
      quantity: '18.000',
      secondaryQuantity: '10',
      unitCost: '73.25',
      expiresInDays: 3,
    },
  ],
} as const;

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
  {
    // One sealed cup of dipping sauce comes with each portion; "no sauce" takes it off (#16).
    code: 'DIPPING-SAUCE',
    nameTh: 'น้ำจิ้มไก่ (ถ้วย)',
    nameEn: 'Dipping sauce (cup)',
    baseUnitCode: 'piece',
    variableWeight: false,
    shelfLifeDays: 180,
    purchaseUnits: [{ unitCode: 'case', factor: '200' }],
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

/**
 * One approved write-off (#8): whole chickens damaged in the plant's chiller, written off the
 * first whole-chicken lot of the opening balance. Raised by the plant, approved by finance —
 * never by the person who raised it (ADR-0008). Fictional, like everything here.
 */
export const DEMO_WRITE_OFF = {
  locationCode: 'PLANT-01',
  note: 'Demo seed: chickens damaged in the chiller (fictional)',
  /** The opening-balance line whose lot is written off. */
  openingBalanceLineNo: 3,
  quantity: '-1.800',
  secondaryQuantity: '-1',
  reason: 'Damaged in the chiller',
} as const;

/** A recipe line: an item code and its quantity in the item's base unit, a decimal string. */
export type DemoRecipeLine = readonly [itemCode: string, quantity: string];

export interface DemoRecipeVersion {
  /** Days from the day the seed runs: -1 is yesterday, the day the opening balance is dated. */
  fromDay: number;
  lines: readonly DemoRecipeLine[];
}

export interface DemoModifierGroup {
  code: string;
  nameTh: string;
  nameEn: string;
  minSelections: number;
  maxSelections: number;
  options: ReadonlyArray<{
    code: string;
    nameTh: string;
    nameEn: string;
    priceChange: string;
    /** Per one unit sold of the line the option is on (contract 1.1). */
    recipes: readonly DemoRecipeVersion[];
  }>;
}

/**
 * The chain's modifiers (#16): a spicy flavour that adds seasoning, and a sauce choice. Option
 * codes are the `modifiers[].code` sales events carry; `SAUCE-HOT` is the contract's example.
 */
export const DEMO_MODIFIER_GROUPS: readonly DemoModifierGroup[] = [
  {
    code: 'FLAVOUR',
    nameTh: 'รสชาติ',
    nameEn: 'Flavour',
    minSelections: 0,
    maxSelections: 1,
    options: [
      {
        code: 'SPICY',
        nameTh: 'สูตรเผ็ด',
        nameEn: 'Spicy',
        priceChange: '0',
        recipes: [{ fromDay: -1, lines: [['SEASONING', '0.005']] }],
      },
    ],
  },
  {
    code: 'SAUCE',
    nameTh: 'น้ำจิ้ม',
    nameEn: 'Sauce',
    minSelections: 0,
    maxSelections: 1,
    options: [
      {
        code: 'SAUCE-HOT',
        nameTh: 'เพิ่มน้ำจิ้มเผ็ด',
        nameEn: 'Extra hot sauce',
        priceChange: '10',
        recipes: [{ fromDay: -1, lines: [['DIPPING-SAUCE', '1']] }],
      },
      {
        code: 'NO-SAUCE',
        nameTh: 'ไม่รับน้ำจิ้ม',
        nameEn: 'No sauce',
        priceChange: '0',
        recipes: [{ fromDay: -1, lines: [['DIPPING-SAUCE', '-1']] }],
      },
    ],
  },
];

export interface DemoMenuItem {
  code: string;
  nameTh: string;
  nameEn: string;
  categoryTh: string;
  categoryEn: string;
  soldBy: 'portion' | 'weight';
  modifierGroupCodes: readonly string[];
  /** Chain-wide when `locationCode` is null; `fromDay` as for recipes. */
  prices: ReadonlyArray<{ locationCode: string | null; fromDay: number; price: string }>;
  /** Per portion, or per kilogram sold for an item sold by weight. */
  recipes: readonly DemoRecipeVersion[];
}

const piece = (
  code: string,
  nameTh: string,
  nameEn: string,
  itemCode: string,
  price: string,
  flour: string,
): DemoMenuItem => ({
  code,
  nameTh,
  nameEn,
  categoryTh: 'ไก่ทอดชิ้นเดี่ยว',
  categoryEn: 'Single pieces',
  soldBy: 'portion',
  modifierGroupCodes: ['FLAVOUR', 'SAUCE'],
  prices: [{ locationCode: null, fromDay: -1, price }],
  recipes: [
    {
      fromDay: -1,
      lines: [
        [itemCode, '1'],
        ['FLOUR', flour],
        ['FRYING-OIL', '0.02'],
        ['DIPPING-SAUCE', '1'],
      ],
    },
  ],
});

/**
 * The chain's menu (#16): single pieces by cut, a two-piece set, six wings, a bucket and fried
 * chicken sold by weight. Recipes consume the items above, so a sale explodes into the stock the
 * plant cuts. Two things are scheduled, to show versioning: the two-piece set's recipe uses less
 * batter from next week, and the bucket's chain-wide price goes up; Silom charges its own price.
 * Prices and figures are fictional.
 */
export const DEMO_MENU_ITEMS: readonly DemoMenuItem[] = [
  piece('BREAST-1', 'อกไก่ทอด 1 ชิ้น', 'Fried breast, 1 piece', 'CHICKEN-BREAST', '49', '0.035'),
  piece('THIGH-1', 'สะโพกไก่ทอด 1 ชิ้น', 'Fried thigh, 1 piece', 'CHICKEN-THIGH', '45', '0.03'),
  piece(
    'DRUMSTICK-1',
    'น่องไก่ทอด 1 ชิ้น',
    'Fried drumstick, 1 piece',
    'CHICKEN-DRUMSTICK',
    '39',
    '0.025',
  ),
  piece('WING-1', 'ปีกไก่ทอด 1 ชิ้น', 'Fried wing, 1 piece', 'CHICKEN-WING', '29', '0.02'),
  {
    code: 'SET-2PC',
    nameTh: 'ชุดไก่ทอด 2 ชิ้น (น่อง + สะโพก)',
    nameEn: 'Two-piece set (drumstick + thigh)',
    categoryTh: 'ชุด',
    categoryEn: 'Sets',
    soldBy: 'portion',
    modifierGroupCodes: ['FLAVOUR', 'SAUCE'],
    prices: [{ locationCode: null, fromDay: -1, price: '79' }],
    recipes: [
      {
        fromDay: -1,
        lines: [
          ['CHICKEN-DRUMSTICK', '1'],
          ['CHICKEN-THIGH', '1'],
          ['FLOUR', '0.06'],
          ['FRYING-OIL', '0.04'],
          ['DIPPING-SAUCE', '1'],
        ],
      },
      {
        fromDay: 7,
        lines: [
          ['CHICKEN-DRUMSTICK', '1'],
          ['CHICKEN-THIGH', '1'],
          ['FLOUR', '0.055'],
          ['FRYING-OIL', '0.04'],
          ['DIPPING-SAUCE', '1'],
        ],
      },
    ],
  },
  {
    code: 'SET-WINGS-6',
    nameTh: 'ปีกไก่ทอด 6 ชิ้น',
    nameEn: 'Six fried wings',
    categoryTh: 'ชุด',
    categoryEn: 'Sets',
    soldBy: 'portion',
    modifierGroupCodes: ['FLAVOUR', 'SAUCE'],
    prices: [{ locationCode: null, fromDay: -1, price: '129' }],
    recipes: [
      {
        fromDay: -1,
        lines: [
          ['CHICKEN-WING', '6'],
          ['FLOUR', '0.12'],
          ['FRYING-OIL', '0.05'],
          ['DIPPING-SAUCE', '1'],
        ],
      },
    ],
  },
  {
    code: 'BUCKET-8',
    nameTh: 'ไก่ทอดถัง 8 ชิ้น',
    nameEn: 'Bucket of eight pieces',
    categoryTh: 'ถัง',
    categoryEn: 'Buckets',
    soldBy: 'portion',
    modifierGroupCodes: ['FLAVOUR', 'SAUCE'],
    prices: [
      { locationCode: null, fromDay: -1, price: '299' },
      { locationCode: 'BR-SILOM', fromDay: -1, price: '319' },
      { locationCode: null, fromDay: 7, price: '309' },
    ],
    recipes: [
      {
        fromDay: -1,
        lines: [
          ['CHICKEN-BREAST', '2'],
          ['CHICKEN-THIGH', '2'],
          ['CHICKEN-DRUMSTICK', '2'],
          ['CHICKEN-WING', '2'],
          ['FLOUR', '0.24'],
          ['FRYING-OIL', '0.16'],
          ['DIPPING-SAUCE', '2'],
        ],
      },
    ],
  },
  {
    // The contract's weighed example (contracts/pos/v1/examples/sales-event.weighed.json).
    code: 'FRIED-CHICKEN-BY-WEIGHT',
    nameTh: 'ไก่ทอดชั่งกิโล',
    nameEn: 'Fried chicken by weight',
    categoryTh: 'ขายตามน้ำหนัก',
    categoryEn: 'By weight',
    soldBy: 'weight',
    modifierGroupCodes: ['FLAVOUR'],
    prices: [{ locationCode: null, fromDay: -1, price: '320' }],
    recipes: [
      {
        fromDay: -1,
        lines: [
          ['WHOLE-CHICKEN', '1.25'],
          ['FLOUR', '0.15'],
          ['FRYING-OIL', '0.08'],
        ],
      },
    ],
  },
];

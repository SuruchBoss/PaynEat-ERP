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
  {
    // Flour and seasoning the plant mixes and sends to the branches (#12).
    code: 'BATTER-MIX',
    nameTh: 'แป้งผสมชุบทอด',
    nameEn: 'Batter mix',
    baseUnitCode: 'kg',
    variableWeight: false,
    shelfLifeDays: 90,
    purchaseUnits: [],
  },
];

/**
 * Receiving tolerances (#11, ADR-0007): chilled whole chicken may arrive 2% off the weight still
 * expected and no warmer than 4 °C; the chilled pieces no warmer than 4 °C either. Everything else
 * has no check. Configuration the admin maintains, not master data.
 */
export const DEMO_RECEIVING_TOLERANCES: Readonly<
  Record<string, { maxVariancePercent: string | null; maxTemperature: string | null }>
> = {
  'WHOLE-CHICKEN': { maxVariancePercent: '2', maxTemperature: '4' },
  'CHICKEN-BREAST': { maxVariancePercent: null, maxTemperature: '4' },
  'CHICKEN-THIGH': { maxVariancePercent: null, maxTemperature: '4' },
  'CHICKEN-DRUMSTICK': { maxVariancePercent: null, maxTemperature: '4' },
  'CHICKEN-WING': { maxVariancePercent: null, maxTemperature: '4' },
};

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

/**
 * The purchase approval threshold the demo company runs with (#10): an order whose gross total is
 * above 20,000 baht needs a purchasing approver. A new real installation starts at zero.
 */
export const DEMO_PURCHASE_APPROVAL_THRESHOLD = '20000.00';

export interface DemoPurchaseOrder {
  supplierCode: string;
  locationCode: string;
  /** Days from the day the seed runs. */
  deliveryInDays: number;
  note: string;
  lines: ReadonlyArray<{
    itemCode: string;
    unitCode: string;
    quantity: string;
    unitPrice: string;
    vatRate: string;
    vatRecoverable: boolean;
  }>;
  /** How far the seed takes it: a draft, or submitted and then sent once approved. */
  until: 'draft' | 'sent';
}

/**
 * Three purchase orders (#10), all fictional. Whole chicken twice: 12 cases (gross 16,486.56,
 * within the threshold, so submitting approves it) and 20 cases (gross 27,477.60, above it, so the
 * purchasing approver approves it — not the purchasing officer who raised it). Both are sent.
 * Flour and oil stay a draft, for an evaluator to submit.
 */
export const DEMO_PURCHASE_ORDERS: readonly DemoPurchaseOrder[] = [
  {
    supplierCode: 'SUP-CHICKEN',
    locationCode: 'PLANT-01',
    deliveryInDays: 2,
    note: 'Demo seed: whole chicken for the week (fictional)',
    lines: [
      {
        itemCode: 'WHOLE-CHICKEN',
        unitCode: 'case',
        quantity: '12',
        unitPrice: '1284.00',
        vatRate: '7',
        vatRecoverable: true,
      },
    ],
    until: 'sent',
  },
  {
    supplierCode: 'SUP-CHICKEN',
    locationCode: 'PLANT-01',
    deliveryInDays: 3,
    note: 'Demo seed: whole chicken for the weekend promotion (fictional)',
    lines: [
      {
        itemCode: 'WHOLE-CHICKEN',
        unitCode: 'case',
        quantity: '20',
        unitPrice: '1284.00',
        vatRate: '7',
        vatRecoverable: true,
      },
    ],
    until: 'sent',
  },
  {
    supplierCode: 'SUP-DRYGOODS',
    locationCode: 'PLANT-01',
    deliveryInDays: 5,
    note: 'Demo seed: batter flour and frying oil (fictional)',
    lines: [
      {
        itemCode: 'FLOUR',
        unitCode: 'bag',
        quantity: '8',
        unitPrice: '812.35',
        vatRate: '7',
        vatRecoverable: true,
      },
      {
        itemCode: 'FRYING-OIL',
        unitCode: 'tin',
        quantity: '10',
        unitPrice: '950.00',
        vatRate: '7',
        vatRecoverable: true,
      },
    ],
    until: 'draft',
  },
];

export interface DemoGoodsReceipt {
  /** Which of DEMO_PURCHASE_ORDERS it receives against. */
  purchaseOrderIndex: number;
  note: string;
  lines: ReadonlyArray<{
    purchaseOrderLineNo: number;
    unitCode: string;
    countedQuantity: string;
    rejectedQuantity: string;
    countedPieces: string | null;
    rejectedPieces: string | null;
    temperature: string | null;
    condition: 'good' | 'damaged';
    /** Days from the day the seed runs, or null when the supplier printed none. */
    supplierExpiresInDays: number | null;
    reason: string | null;
  }>;
}

/**
 * Two goods receipts (#11), both fictional, of the two whole-chicken orders, received today by
 * the plant. The first is within tolerance — 238.4 kg as 132 birds against 240 kg, 2.8 °C, the
 * supplier's date later than five days' shelf life — so submitting it posts one lot at 64.2 a kg
 * and completes the order. The second arrived warm (5.6 °C), with ten birds in torn packaging and
 * a supplier date a day short: those ten birds go back to the supplier, and the purchasing
 * approver, not the plant, approves the rest, which posts a lot that takes the supplier's date
 * and leaves the order partially received.
 */
export const DEMO_GOODS_RECEIPTS: readonly DemoGoodsReceipt[] = [
  {
    purchaseOrderIndex: 0,
    note: 'Demo seed: Monday delivery, within tolerance (fictional)',
    lines: [
      {
        purchaseOrderLineNo: 1,
        unitCode: 'kg',
        countedQuantity: '238.4',
        rejectedQuantity: '0',
        countedPieces: '132',
        rejectedPieces: '0',
        temperature: '2.8',
        condition: 'good',
        supplierExpiresInDays: 6,
        reason: null,
      },
    ],
  },
  {
    purchaseOrderIndex: 1,
    note: 'Demo seed: weekend delivery, warm truck (fictional)',
    lines: [
      {
        purchaseOrderLineNo: 1,
        unitCode: 'kg',
        countedQuantity: '402',
        rejectedQuantity: '18',
        countedPieces: '223',
        rejectedPieces: '10',
        temperature: '5.6',
        condition: 'damaged',
        supplierExpiresInDays: 4,
        reason:
          'Truck chiller fault: 5.6 °C at the door, 3.9 °C core on re-test. Ten birds in torn packaging returned. Supplier date one day short: use first.',
      },
    ],
  },
];

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
  /** A branch row with a null price returns that branch to the chain-wide price (ADR-0023). */
  prices: ReadonlyArray<{ locationCode: string | null; fromDay: number; price: string | null }>;
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
      { locationCode: 'BR-SILOM', fromDay: 14, price: null },
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

/** A BOM line: an item code, its quantity per batch in the base unit, and options. */
export interface DemoBomLine {
  itemCode: string;
  quantity: string;
  /** For items not counted in kg or g. */
  expectedWeightKg?: string;
  /** Outputs only, when the BOM overrides the weight-share ratios. */
  allocationRatio?: string;
}

export interface DemoProductionBom {
  code: string;
  nameTh: string;
  nameEn: string;
  /** Days from the day the seed runs: -1 is yesterday, the day the opening balance is dated. */
  fromDay: number;
  inputs: readonly DemoBomLine[];
  outputs: readonly DemoBomLine[];
}

/**
 * Production BOMs (#12, ADR-0026). Cutting one case of whole chicken (20 kg) yields 22 of each
 * piece and 4.4 kg of frames: 18 kg expected, 2 kg waste, 90 % yield. By weight the frames would
 * carry 24.44 % of the cost; the chain overrides that so the pieces it sells carry it and the
 * frames, sold off for stock, carry 8 %. The batter mix keeps the default: its one output
 * carries everything.
 */
export const DEMO_PRODUCTION_BOMS: readonly DemoProductionBom[] = [
  {
    code: 'CUT-WHOLE-CHICKEN',
    nameTh: 'ตัดแต่งไก่ทั้งตัว',
    nameEn: 'Cut whole chicken',
    fromDay: -1,
    inputs: [{ itemCode: 'WHOLE-CHICKEN', quantity: '20' }],
    outputs: [
      { itemCode: 'CHICKEN-BREAST', quantity: '22', expectedWeightKg: '5', allocationRatio: '35' },
      { itemCode: 'CHICKEN-THIGH', quantity: '22', expectedWeightKg: '3.6', allocationRatio: '22' },
      {
        itemCode: 'CHICKEN-DRUMSTICK',
        quantity: '22',
        expectedWeightKg: '2.8',
        allocationRatio: '18',
      },
      { itemCode: 'CHICKEN-WING', quantity: '22', expectedWeightKg: '2.2', allocationRatio: '17' },
      { itemCode: 'CHICKEN-FRAME', quantity: '4.4', allocationRatio: '8' },
    ],
  },
  {
    code: 'MIX-BATTER',
    nameTh: 'ผสมแป้งชุบทอด',
    nameEn: 'Mix batter',
    fromDay: -1,
    inputs: [
      { itemCode: 'FLOUR', quantity: '25' },
      { itemCode: 'SEASONING', quantity: '1' },
    ],
    outputs: [{ itemCode: 'BATTER-MIX', quantity: '25.8' }],
  },
];

export interface DemoProductionOrder {
  bomCode: string;
  locationCode: string;
  /** Of the BOM's first input, in its base unit. */
  plannedQuantity: string;
  note: string;
  /**
   * Birds counted out of each lot FEFO picked, by the lot's place in FEFO order: the whole lot's
   * count when it is used up, a count of what was taken when it is not.
   */
  piecesPerPick: readonly string[];
  /** What came out, per BOM output line, in order. */
  outputs: ReadonlyArray<{ quantity: string; pieces: string | null; weightKg: string | null }>;
}

/**
 * One whole-chicken cutting order (#13), released, recorded and posted by the plant today: 200 kg
 * of whole chicken, picked first-expired-first-out, so the three opening-balance lots go first and
 * the rest comes from the warm-truck delivery received in #11. It yields 176 kg of pieces and
 * frames, 88 % against the BOM's 90 %, so every piece carries a little more cost than the BOM
 * expects; and because the oldest chicken it used expires tomorrow, so do the pieces it made
 * (ADR-0014). Counts and weights are invented.
 */
export const DEMO_PRODUCTION_ORDER: DemoProductionOrder = {
  bomCode: 'CUT-WHOLE-CHICKEN',
  locationCode: 'PLANT-01',
  plannedQuantity: '200',
  note: 'Demo seed: morning cut, 111 birds (fictional)',
  piecesPerPick: ['11', '24', '10', '66'],
  outputs: [
    { quantity: '220', pieces: null, weightKg: '49.2' },
    { quantity: '222', pieces: null, weightKg: '35.4' },
    { quantity: '222', pieces: null, weightKg: '27.6' },
    { quantity: '218', pieces: null, weightKg: '21.5' },
    { quantity: '42.3', pieces: '111', weightKg: null },
  ],
};

export interface DemoTransfer {
  destinationCode: string;
  note: string;
  /**
   * What logistics sends, per item, in its base unit (#14). The branch's requisition (#15) asks
   * for the same unless `requested` says more: the rest stays outstanding.
   */
  lines: ReadonlyArray<{ itemCode: string; quantity: string; requested?: string }>;
  /**
   * How lines arrived when they did not arrive as dispatched, by item. Everything else arrives
   * whole, at the default temperature, in good condition.
   */
  arrivals: Readonly<
    Record<string, { received?: string; temperature?: string; writtenOff?: string; reason: string }>
  >;
}

/** The back-door probe reading for lines nothing else is said about: cold enough. */
export const DEMO_ARRIVAL_TEMPERATURE = '3.2';

/**
 * The chicken pieces leave the plant in trays of ten (#15): a branch asks for them, and is
 * suggested them, in whole trays.
 */
export const DEMO_REQUISITION_UNITS: Readonly<Record<string, string>> = {
  'CHICKEN-BREAST': '10',
  'CHICKEN-THIGH': '10',
  'CHICKEN-DRUMSTICK': '10',
  'CHICKEN-WING': '10',
};

/**
 * How much of each item each branch should hold (#15, ADR-0009 decision 2), in base units.
 * Silom is the busiest; Bang Na sells no thighs or wings, so has no par level for them and gets
 * no suggestion for them. Invented figures.
 */
export const DEMO_PAR_LEVELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'BR-SILOM': {
    'CHICKEN-BREAST': '60',
    'CHICKEN-THIGH': '60',
    'CHICKEN-DRUMSTICK': '50',
    'CHICKEN-WING': '60',
  },
  'BR-ARI': { 'CHICKEN-BREAST': '40', 'CHICKEN-THIGH': '40', 'CHICKEN-WING': '40' },
  'BR-BANGNA': { 'CHICKEN-BREAST': '40', 'CHICKEN-DRUMSTICK': '40' },
};

/**
 * Three transfers (#14), dispatched today by logistics from the plant to each branch with pieces
 * from the morning cut (DEMO_PRODUCTION_ORDER), FEFO, and received by the branch manager. Silom
 * receives everything as sent. Ari is two wings short: they are written off with a reason, which
 * the plant approves. Bang Na's breasts arrive at 5.1 °C against a 4 °C limit: accepted with a
 * reason, approved by the plant. Each transfer is created by logistics from its branch's
 * requisition (#15), raised and submitted by the branch manager for today: Silom's and Ari's are
 * fulfilled; Bang Na asked for 40 drumsticks and got 30, so its requisition stays partially
 * fulfilled in logistics' queue. Counts and temperatures are invented.
 */
export const DEMO_TRANSFERS: readonly DemoTransfer[] = [
  {
    destinationCode: 'BR-SILOM',
    note: 'Demo seed: Silom morning delivery (fictional)',
    lines: [
      { itemCode: 'CHICKEN-BREAST', quantity: '40' },
      { itemCode: 'CHICKEN-THIGH', quantity: '40' },
      { itemCode: 'CHICKEN-DRUMSTICK', quantity: '40' },
      { itemCode: 'CHICKEN-WING', quantity: '40' },
    ],
    arrivals: {},
  },
  {
    destinationCode: 'BR-ARI',
    note: 'Demo seed: Ari morning delivery (fictional)',
    lines: [
      { itemCode: 'CHICKEN-BREAST', quantity: '30' },
      { itemCode: 'CHICKEN-THIGH', quantity: '30' },
      { itemCode: 'CHICKEN-WING', quantity: '30' },
    ],
    arrivals: {
      'CHICKEN-WING': {
        received: '28',
        writtenOff: '2',
        reason: 'Two wings missing from the tray at the back door (fictional)',
      },
    },
  },
  {
    destinationCode: 'BR-BANGNA',
    note: 'Demo seed: Bang Na morning delivery (fictional)',
    lines: [
      { itemCode: 'CHICKEN-BREAST', quantity: '30' },
      { itemCode: 'CHICKEN-DRUMSTICK', quantity: '30', requested: '40' },
    ],
    arrivals: {
      'CHICKEN-BREAST': {
        temperature: '5.1',
        reason: 'Truck stuck in traffic; core temperature checked at 3.8 °C, accepted (fictional)',
      },
    },
  },
];

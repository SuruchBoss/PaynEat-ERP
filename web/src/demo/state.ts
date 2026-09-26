// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * What the in-browser demo API holds (#41): the demo seed's chain, in memory, for one visit.
 * A reload starts again from `seedState`. Shapes follow the backend's tables closely enough
 * that the answers built from them match the real API's. The seed's ids are fixed, so a
 * session kept across a reload still names the same demo accounts.
 */
import { addDays, dateIn } from '@backend/src/core/time/domain/business-date';
import type { Role } from '@backend/src/core/security/permissions';
import { lotNumber } from '@backend/src/modules/ledger/domain/posting-rules';
import {
  DEMO_ITEMS,
  DEMO_LOCATIONS,
  DEMO_MFA_SECRET,
  DEMO_OPENING_BALANCE,
  DEMO_PASSWORD,
  DEMO_RECOVERY_CODES,
  DEMO_SUPPLIERS,
  DEMO_USERS,
} from './seed';
import { normaliseRecoveryCode } from './totp';

export type LocationType = 'plant' | 'warehouse' | 'branch' | 'in_transit' | 'subcontractor';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  password: string;
  locale: 'th' | 'en';
  status: 'ACTIVE' | 'DISABLED';
  roles: Role[];
  mfaEnabled: boolean;
  mfaEnrolledAt: string | null;
  /** The active second factor's secret, or the pending one while enrolling. */
  mfaSecret: string | null;
  /** Normalised, unused recovery codes. */
  recoveryCodes: string[];
  lastUsedStep: number | null;
  failedLogins: number;
  lockedUntil: number | null;
  /** Sessions issued before this instant (ms) are over: "sign out everywhere". */
  sessionsEndedAt: number | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ItemRecord {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  baseUnitCode: string;
  variableWeight: boolean;
  shelfLifeDays: number;
  active: boolean;
  purchaseUnits: Array<{ unitCode: string; factor: string }>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocationRecord {
  id: string;
  code: string;
  type: LocationType;
  nameTh: string;
  nameEn: string;
  active: boolean;
  originId: string | null;
  supersededById: string | null;
  firstUsedAt: string | null;
  firstUse: string | null;
  revision: number;
  masterDataVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierRecord {
  id: string;
  code: string;
  name: string;
  taxId: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  id: string;
  number: string;
  type: 'opening_balance' | 'reversal';
  status: 'draft' | 'posted';
  businessDate: string;
  note: string | null;
  revision: number;
  createdById: string;
  createdAt: string;
  postedById: string | null;
  postedAt: string | null;
  reversesId: string | null;
}

export interface OpeningBalanceLine {
  lineNo: number;
  itemId: string;
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
}

export interface OpeningBalanceRecord {
  documentId: string;
  locationId: string;
  lines: OpeningBalanceLine[];
}

export interface LotRecord {
  id: string;
  number: string;
  itemId: string;
  originDocumentId: string;
  lineNo: number;
  unitCost: string;
  expiryDate: string;
}

export interface EntryRecord {
  id: string;
  documentId: string;
  lineNo: number;
  itemId: string;
  lotId: string;
  locationId: string;
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  businessDate: string;
  reversesEntryId: string | null;
}

export interface DemoState {
  users: UserRecord[];
  items: ItemRecord[];
  locations: LocationRecord[];
  suppliers: SupplierRecord[];
  documents: DocumentRecord[];
  openingBalances: OpeningBalanceRecord[];
  lots: LotRecord[];
  entries: EntryRecord[];
  masterDataVersion: number;
  sequences: Map<string, number>;
  challenges: Map<string, { userId: string; expiresAt: number }>;
  /** Tokens ended by signing out or by being refreshed. */
  revokedTokens: Set<string>;
}

export const id = (): string => crypto.randomUUID();

/** A fixed, well-formed UUID for the `index`th seed record of one kind. */
export function seedId(kind: number, index: number): string {
  const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');
  return `d${hex(kind, 7)}-0000-4000-8000-${hex(index + 1, 12)}`;
}

const KIND = { user: 1, location: 2, supplier: 3, item: 4, document: 5, lot: 6, entry: 7 };

/** The demo company's time zone: business dates are counted here (backend `COMPANY_TIME_ZONE`). */
export const DEMO_TIME_ZONE = 'Asia/Bangkok';

/** The demo seed, built fresh for `now`: dates count from the day the visit starts. */
export function seedState(now: Date): DemoState {
  const at = now.toISOString();
  const today = dateIn(DEMO_TIME_ZONE, now);
  const state: DemoState = {
    users: [],
    items: [],
    locations: [],
    suppliers: [],
    documents: [],
    openingBalances: [],
    lots: [],
    entries: [],
    masterDataVersion: 0,
    sequences: new Map(),
    challenges: new Map(),
    revokedTokens: new Set(),
  };

  state.users = DEMO_USERS.map((demo, index) => ({
    id: seedId(KIND.user, index),
    email: demo.email,
    displayName: demo.displayName,
    password: DEMO_PASSWORD,
    locale: 'th',
    status: 'ACTIVE',
    roles: [demo.role],
    mfaEnabled: demo.role === 'admin',
    mfaEnrolledAt: demo.role === 'admin' ? at : null,
    mfaSecret: demo.role === 'admin' ? DEMO_MFA_SECRET : null,
    recoveryCodes: demo.role === 'admin' ? DEMO_RECOVERY_CODES.map(normaliseRecoveryCode) : [],
    lastUsedStep: null,
    failedLogins: 0,
    lockedUntil: null,
    sessionsEndedAt: null,
    lastLoginAt: null,
    createdAt: at,
  }));

  for (const demo of DEMO_LOCATIONS) {
    const version = demo.type === 'branch' ? ++state.masterDataVersion : null;
    const location: LocationRecord = {
      id: seedId(KIND.location, state.locations.length),
      code: demo.code,
      type: demo.type,
      nameTh: demo.nameTh,
      nameEn: demo.nameEn,
      active: true,
      originId: null,
      supersededById: null,
      firstUsedAt: null,
      firstUse: null,
      revision: 1,
      masterDataVersion: version,
      createdAt: at,
      updatedAt: at,
    };
    state.locations.push(location);
    if (demo.type === 'plant') {
      state.locations.push({
        ...location,
        id: seedId(KIND.location, state.locations.length),
        code: `IN-TRANSIT:${demo.code}`,
        type: 'in_transit',
        nameTh: `ระหว่างขนส่งจาก ${demo.nameTh}`,
        nameEn: `In transit from ${demo.nameEn}`,
        originId: location.id,
        masterDataVersion: null,
      });
    }
  }

  state.suppliers = DEMO_SUPPLIERS.map((demo, index) => ({
    id: seedId(KIND.supplier, index),
    ...demo,
    active: true,
    revision: 1,
    createdAt: at,
    updatedAt: at,
  }));

  state.items = DEMO_ITEMS.map((demo, index) => ({
    id: seedId(KIND.item, index),
    ...demo,
    purchaseUnits: [...demo.purchaseUnits],
    active: true,
    version: ++state.masterDataVersion,
    createdAt: at,
    updatedAt: at,
  }));

  // The plant's opening balance, posted yesterday by the demo plant user (#7).
  const plant = state.locations.find((l) => l.code === DEMO_OPENING_BALANCE.locationCode)!;
  const plantUser = state.users.find((u) => u.roles.includes('plant'))!;
  const year = today.slice(0, 4);
  state.sequences.set(`OB:${year}`, 1);
  const document: DocumentRecord = {
    id: seedId(KIND.document, 0),
    number: `OB-${year}-00001`,
    type: 'opening_balance',
    status: 'posted',
    businessDate: addDays(today, -1),
    note: DEMO_OPENING_BALANCE.note,
    revision: 2,
    createdById: plantUser.id,
    createdAt: at,
    postedById: plantUser.id,
    postedAt: at,
    reversesId: null,
  };
  state.documents.push(document);
  const lines: OpeningBalanceLine[] = DEMO_OPENING_BALANCE.lines.map((line, index) => ({
    lineNo: index + 1,
    itemId: state.items.find((i) => i.code === line.itemCode)!.id,
    quantity: line.quantity,
    secondaryQuantity: 'secondaryQuantity' in line ? line.secondaryQuantity : null,
    unitCost: line.unitCost,
    expiryDate: addDays(today, line.expiresInDays),
  }));
  state.openingBalances.push({ documentId: document.id, locationId: plant.id, lines });
  for (const line of lines) {
    const lot: LotRecord = {
      id: seedId(KIND.lot, line.lineNo - 1),
      number: lotNumber(document.number, line.lineNo),
      itemId: line.itemId,
      originDocumentId: document.id,
      lineNo: line.lineNo,
      unitCost: line.unitCost,
      expiryDate: line.expiryDate,
    };
    state.lots.push(lot);
    state.entries.push({
      id: seedId(KIND.entry, line.lineNo - 1),
      documentId: document.id,
      lineNo: line.lineNo,
      itemId: line.itemId,
      lotId: lot.id,
      locationId: plant.id,
      quantity: line.quantity,
      secondaryQuantity: line.secondaryQuantity,
      unitCost: line.unitCost,
      businessDate: document.businessDate,
      reversesEntryId: null,
    });
  }
  plant.firstUsedAt = at;
  plant.firstUse = `posted document ${document.number}`;
  return state;
}

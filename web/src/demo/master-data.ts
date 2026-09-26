// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Items, units, locations and suppliers in the demo API (#41, ADR-0021). Every rule is the
 * backend's own `domain/` function, imported; what is written here is only the order the
 * backend's services apply them in (`modules/items`, `modules/locations`, `modules/suppliers`)
 * and the codes they refuse with, so the same request is refused for the same reason.
 */
import {
  normalisePurchaseUnits,
  purchaseUnitIssues,
  type PurchaseUnitInput,
} from '@backend/src/modules/items/domain/item-rules';
import {
  createProblem,
  editProblem,
  inTransitCode,
  LOCATION_CODE_PATTERN,
  locationCodeProblem,
  normaliseLocationCode,
  shipsThroughInTransit,
  supersedeProblem,
  type LocationState,
} from '@backend/src/modules/locations/domain/location-rules';
import {
  normaliseTaxId,
  thaiTaxIdProblem,
} from '@backend/src/modules/suppliers/domain/thai-tax-id';
import { conflict, Input, notFound, queryValue, refused, uuidParam, type Context } from './http';
import { UNITS } from './seed';
import {
  id,
  type DemoState,
  type ItemRecord,
  type LocationRecord,
  type LocationType,
  type SupplierRecord,
} from './state';

const STATUSES = ['active', 'inactive', 'all'] as const;
/** Item and supplier codes have the location code's shape (their DTOs, docs/GLOSSARY.md). */
const CODE_PATTERN = LOCATION_CODE_PATTERN;
const CODE_MESSAGE =
  'code must be 2–32 capital letters, digits or hyphens, starting with a letter or digit';

const byCode = <T extends { code: string }>(a: T, b: T) =>
  a.code < b.code ? -1 : a.code > b.code ? 1 : 0;

function statusFilter(query: URLSearchParams, fallback: 'active' | 'all') {
  const status = queryValue(query, 'status', { oneOf: STATUSES }) ?? fallback;
  return (row: { active: boolean }) => status === 'all' || row.active === (status === 'active');
}

// --- Units and items (backend modules/items) -------------------------------------------------

export function units() {
  return UNITS.map((unit) => ({ ...unit }));
}

export function unitDecimals(code: string): number {
  return UNITS.find((u) => u.code === code)?.decimals ?? 0;
}

const KNOWN_UNITS: ReadonlySet<string> = new Set(UNITS.map((u) => u.code));

function itemView(item: ItemRecord) {
  return { ...item, purchaseUnits: item.purchaseUnits.map((p) => ({ ...p })) };
}

export function listItems(state: DemoState, ctx: Context) {
  const keep = statusFilter(ctx.query, 'active');
  const q = queryValue(ctx.query, 'q', {})?.trim().toLowerCase();
  return state.items
    .filter(keep)
    .filter(
      (item) =>
        !q || [item.code, item.nameTh, item.nameEn].some((text) => text.toLowerCase().includes(q)),
    )
    .sort(byCode)
    .map(itemView);
}

function findItem(state: DemoState, itemId: string): ItemRecord {
  const item = state.items.find((i) => i.id === uuidParam(itemId));
  if (!item) throw notFound('Item', itemId);
  return item;
}

export function getItem(state: DemoState, ctx: Context) {
  return itemView(findItem(state, ctx.params[0]));
}

type PurchaseUnit = PurchaseUnitInput;

function purchaseUnitsInput(input: Input, optional: boolean): PurchaseUnit[] | undefined {
  return input.list('purchaseUnits', { max: 20, optional }, (element, prefix, problems) => {
    const unit = new Input(element, ['unitCode', 'factor'], prefix, problems);
    return {
      unitCode: unit.text('unitCode', { notEmpty: true }),
      factor: unit.text('factor', { trim: true }),
    };
  });
}

/** Refused with every problem, or the list as stored: minimal factors, sorted by unit. */
function validPurchaseUnits(baseUnitCode: string, purchaseUnits: PurchaseUnit[]): PurchaseUnit[] {
  const issues = purchaseUnitIssues(baseUnitCode, purchaseUnits, KNOWN_UNITS);
  if (issues.length > 0) {
    throw refused(
      'INVALID_PURCHASE_UNITS',
      `Purchase units: ${issues.map((i) => `${i.unitCode} ${i.problem}`).join(', ')}`,
      { issues },
    );
  }
  return normalisePurchaseUnits(purchaseUnits);
}

export function createItem(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, [
    'code',
    'baseUnitCode',
    'nameTh',
    'nameEn',
    'variableWeight',
    'shelfLifeDays',
    'purchaseUnits',
  ]);
  const code = input.text('code', {
    trim: true,
    upper: true,
    pattern: CODE_PATTERN,
    patternMessage: CODE_MESSAGE,
  });
  const baseUnitCode = input.text('baseUnitCode', { notEmpty: true });
  const nameTh = input.text('nameTh', { trim: true, notEmpty: true, max: 120 });
  const nameEn = input.text('nameEn', { trim: true, notEmpty: true, max: 120 });
  const variableWeight = input.bool('variableWeight');
  const shelfLifeDays = input.int('shelfLifeDays', { min: 1, max: 36500 });
  const purchaseUnits = purchaseUnitsInput(input, false)!;
  input.done();

  if (!KNOWN_UNITS.has(baseUnitCode)) {
    throw refused('UNKNOWN_UNIT', `There is no unit "${baseUnitCode}"`, { field: 'baseUnitCode' });
  }
  const units = validPurchaseUnits(baseUnitCode, purchaseUnits);
  if (state.items.some((i) => i.code === code)) {
    throw conflict('ITEM_CODE_TAKEN', `An item with code ${code} already exists`);
  }
  const at = new Date(ctx.now).toISOString();
  const item: ItemRecord = {
    id: id(),
    code,
    nameTh,
    nameEn,
    baseUnitCode,
    variableWeight,
    shelfLifeDays,
    active: true,
    purchaseUnits: units,
    version: ++state.masterDataVersion,
    createdAt: at,
    updatedAt: at,
  };
  state.items.push(item);
  return itemView(item);
}

/** Refused when the editor's version is stale; a change that changes nothing keeps it. */
export function updateItem(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, [
    'version',
    'nameTh',
    'nameEn',
    'variableWeight',
    'shelfLifeDays',
    'active',
    'purchaseUnits',
  ]);
  const version = input.int('version', { min: 1 });
  const nameTh = input.optionalText('nameTh', { trim: true, notEmpty: true, max: 120 });
  const nameEn = input.optionalText('nameEn', { trim: true, notEmpty: true, max: 120 });
  const variableWeight = input.optionalBool('variableWeight');
  const shelfLifeDays = input.optionalInt('shelfLifeDays', { min: 1, max: 36500 });
  const active = input.optionalBool('active');
  const purchaseUnits = purchaseUnitsInput(input, true);
  input.done();

  const item = findItem(state, ctx.params[0]);
  if (item.version !== version) {
    throw conflict(
      'ITEM_CHANGED',
      'This item was changed by someone else since you opened it. Reload it and try again.',
      { currentVersion: item.version },
    );
  }
  const units = purchaseUnits ? validPurchaseUnits(item.baseUnitCode, purchaseUnits) : undefined;
  const next = { nameTh, nameEn, variableWeight, shelfLifeDays, active };
  const changed =
    Object.entries(next).some(
      ([field, value]) => value !== undefined && value !== item[field as keyof typeof next],
    ) ||
    (units !== undefined && JSON.stringify(units) !== JSON.stringify(item.purchaseUnits));
  if (!changed) return itemView(item);

  if (nameTh !== undefined && nameTh !== null) item.nameTh = nameTh;
  if (nameEn !== undefined && nameEn !== null) item.nameEn = nameEn;
  if (variableWeight !== undefined) item.variableWeight = variableWeight;
  if (shelfLifeDays !== undefined) item.shelfLifeDays = shelfLifeDays;
  if (active !== undefined) item.active = active;
  if (units) item.purchaseUnits = units;
  item.version = ++state.masterDataVersion;
  item.updatedAt = new Date(ctx.now).toISOString();
  return itemView(item);
}

// --- Locations (backend modules/locations) ---------------------------------------------------

const LOCATION_TYPES = ['plant', 'warehouse', 'branch', 'in_transit', 'subcontractor'] as const;

const EDIT_ERRORS = {
  SYSTEM_MANAGED: [
    'LOCATION_SYSTEM_MANAGED',
    'In-transit locations are managed by the system and cannot be changed',
  ],
  CODE_IN_USE: [
    'LOCATION_CODE_IN_USE',
    'This code is already in use and can no longer change. Create a new location and supersede this one.',
  ],
  SUPERSEDED: [
    'LOCATION_SUPERSEDED',
    'This location was superseded by another and stays out of use',
  ],
} as const;

const SUPERSEDE_ERRORS = {
  SYSTEM_MANAGED: [
    'LOCATION_SYSTEM_MANAGED',
    'In-transit locations are managed by the system and cannot be superseded',
  ],
  ALREADY_SUPERSEDED: ['LOCATION_SUPERSEDED', 'This location has already been superseded'],
  SAME_LOCATION: ['SUPERSEDE_SAME_LOCATION', 'A location cannot supersede itself'],
  DIFFERENT_TYPE: [
    'SUPERSEDE_DIFFERENT_TYPE',
    'A location can only be superseded by one of the same type',
  ],
  REPLACEMENT_INACTIVE: [
    'SUPERSEDE_REPLACEMENT_INACTIVE',
    'The replacement must be an active location that has not been superseded itself',
  ],
} as const;

/** How the backend's LocationsService names an in-transit location after its origin. */
const inTransitNames = (nameTh: string, nameEn: string) => ({
  nameTh: `ระหว่างขนส่งจาก ${nameTh}`,
  nameEn: `In transit from ${nameEn}`,
});

function ref(state: DemoState, locationId: string | null) {
  const location = locationId ? state.locations.find((l) => l.id === locationId) : undefined;
  return location ? { id: location.id, code: location.code } : null;
}

function locationView(state: DemoState, location: LocationRecord) {
  const inTransit = state.locations.find((l) => l.originId === location.id);
  return {
    id: location.id,
    code: location.code,
    type: location.type,
    nameTh: location.nameTh,
    nameEn: location.nameEn,
    active: location.active,
    origin: ref(state, location.originId),
    inTransit: inTransit ? { id: inTransit.id, code: inTransit.code } : null,
    supersededBy: ref(state, location.supersededById),
    firstUsedAt: location.firstUsedAt,
    firstUse: location.firstUse,
    revision: location.revision,
    masterDataVersion: location.masterDataVersion,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  };
}

export function listLocations(state: DemoState, ctx: Context) {
  const keep = statusFilter(ctx.query, 'active');
  const type = queryValue(ctx.query, 'type', { oneOf: LOCATION_TYPES });
  return state.locations
    .filter(keep)
    .filter((l) => !type || l.type === type)
    .sort((a, b) => LOCATION_TYPES.indexOf(a.type) - LOCATION_TYPES.indexOf(b.type) || byCode(a, b))
    .map((l) => locationView(state, l));
}

export function findLocation(state: DemoState, locationId: string): LocationRecord {
  const location = state.locations.find((l) => l.id === uuidParam(locationId));
  if (!location) throw notFound('Location', locationId);
  return location;
}

export function getLocation(state: DemoState, ctx: Context) {
  return locationView(state, findLocation(state, ctx.params[0]));
}

function validCode(code: string): string {
  const problem = locationCodeProblem(code);
  if (problem) {
    throw refused(
      'INVALID_LOCATION_CODE',
      'A location code is 2–32 capital letters, digits or hyphens, starting with a letter or digit',
      { problem },
    );
  }
  return code;
}

function codeTaken(state: DemoState, code: string, except?: string): never | void {
  if (state.locations.some((l) => l.code === code && l.id !== except)) {
    throw conflict('LOCATION_CODE_TAKEN', `A location with code ${code} already exists`);
  }
}

export function createLocation(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['code', 'type', 'nameTh', 'nameEn']);
  const rawCode = input.text('code', { max: 64 });
  const type = input.text('type', { oneOf: LOCATION_TYPES }) as LocationType;
  const nameTh = input.text('nameTh', { trim: true, notEmpty: true, max: 120 });
  const nameEn = input.text('nameEn', { trim: true, notEmpty: true, max: 120 });
  input.done();

  const typeRefused = createProblem(type);
  if (typeRefused === 'TYPE_SYSTEM_MANAGED') {
    throw refused(
      'LOCATION_TYPE_SYSTEM_MANAGED',
      'In-transit locations are created by the system with each plant and warehouse',
    );
  }
  if (typeRefused === 'TYPE_RESERVED') {
    throw refused(
      'LOCATION_TYPE_RESERVED',
      'Subcontractor locations are reserved and not available yet (ADR-0001)',
    );
  }
  const code = validCode(normaliseLocationCode(rawCode));
  codeTaken(state, code);

  const at = new Date(ctx.now).toISOString();
  const location: LocationRecord = {
    id: id(),
    code,
    type,
    nameTh,
    nameEn,
    active: true,
    originId: null,
    supersededById: null,
    firstUsedAt: null,
    firstUse: null,
    revision: 1,
    masterDataVersion: type === 'branch' ? ++state.masterDataVersion : null,
    createdAt: at,
    updatedAt: at,
  };
  state.locations.push(location);
  if (shipsThroughInTransit(type)) {
    state.locations.push({
      ...location,
      id: id(),
      code: inTransitCode(code),
      type: 'in_transit',
      ...inTransitNames(nameTh, nameEn),
      originId: location.id,
      masterDataVersion: null,
    });
  }
  return locationView(state, location);
}

/** What the backend's location rules look at. */
function locationState(location: LocationRecord): LocationState {
  return {
    type: location.type,
    active: location.active,
    firstUsedAt: location.firstUsedAt ? new Date(location.firstUsedAt) : null,
    supersededById: location.supersededById,
  };
}

function assertRevision(location: LocationRecord, revision: number): void {
  if (location.revision !== revision) {
    throw conflict(
      'LOCATION_CHANGED',
      'This location was changed by someone else since you opened it. Reload it and try again.',
      { currentRevision: location.revision },
    );
  }
}

/** A plant's or warehouse's in-transit location takes its code, names and active flag. */
function followWithInTransit(state: DemoState, origin: LocationRecord, at: string): void {
  const inTransit = state.locations.find((l) => l.originId === origin.id);
  if (!inTransit) return;
  const next = {
    code: inTransitCode(origin.code),
    ...inTransitNames(origin.nameTh, origin.nameEn),
    active: origin.active,
  };
  const changes = (Object.keys(next) as Array<keyof typeof next>).some(
    (field) => next[field] !== inTransit[field],
  );
  if (!changes) return;
  Object.assign(inTransit, next, { revision: inTransit.revision + 1, updatedAt: at });
}

export function updateLocation(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['revision', 'code', 'nameTh', 'nameEn', 'active']);
  const revision = input.int('revision', { min: 1 });
  const rawCode = input.optionalText('code', { max: 64 });
  const nameTh = input.optionalText('nameTh', { trim: true, notEmpty: true, max: 120 });
  const nameEn = input.optionalText('nameEn', { trim: true, notEmpty: true, max: 120 });
  const active = input.optionalBool('active');
  input.done();

  const code = typeof rawCode === 'string' ? normaliseLocationCode(rawCode) : undefined;
  const location = findLocation(state, ctx.params[0]);
  assertRevision(location, revision);

  const codeChanges = code !== undefined && code !== location.code;
  const problem = editProblem(locationState(location), { codeChanges, active });
  if (problem) {
    const [code, message] = EDIT_ERRORS[problem];
    throw refused(code, message);
  }
  if (codeChanges) {
    validCode(code);
    codeTaken(state, code, location.id);
  }

  const next = { code, nameTh: nameTh ?? undefined, nameEn: nameEn ?? undefined, active };
  const changed = (Object.keys(next) as Array<keyof typeof next>).some(
    (field) => next[field] !== undefined && next[field] !== location[field],
  );
  if (!changed) return locationView(state, location);

  const at = new Date(ctx.now).toISOString();
  if (codeChanges) location.code = code;
  if (next.nameTh !== undefined) location.nameTh = next.nameTh;
  if (next.nameEn !== undefined) location.nameEn = next.nameEn;
  if (active !== undefined) location.active = active;
  location.revision += 1;
  location.updatedAt = at;
  if (location.type === 'branch') location.masterDataVersion = ++state.masterDataVersion;
  followWithInTransit(state, location, at);
  return locationView(state, location);
}

/** The fix for a wrong code in use: a location of the same type takes over. */
export function supersedeLocation(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['revision', 'byLocationId']);
  const revision = input.int('revision', { min: 1 });
  const byLocationId = input.text('byLocationId', { uuid: true });
  input.done();

  const location = findLocation(state, ctx.params[0]);
  const replacement = findLocation(state, byLocationId);
  assertRevision(location, revision);

  const problem = supersedeProblem({ id: location.id, ...locationState(location) }, replacement);
  if (problem) {
    const [code, message] = SUPERSEDE_ERRORS[problem];
    throw refused(code, message);
  }

  const at = new Date(ctx.now).toISOString();
  location.active = false;
  location.supersededById = replacement.id;
  location.revision += 1;
  location.updatedAt = at;
  if (location.type === 'branch') location.masterDataVersion = ++state.masterDataVersion;
  followWithInTransit(state, location, at);
  return locationView(state, location);
}

// --- Suppliers (backend modules/suppliers) ---------------------------------------------------

const CONTACT_FIELDS = ['contactName', 'phone', 'email', 'address'] as const;

export function listSuppliers(state: DemoState, ctx: Context) {
  const keep = statusFilter(ctx.query, 'active');
  return state.suppliers
    .filter(keep)
    .sort(byCode)
    .map((s) => ({ ...s }));
}

function findSupplier(state: DemoState, supplierId: string): SupplierRecord {
  const supplier = state.suppliers.find((s) => s.id === uuidParam(supplierId));
  if (!supplier) throw notFound('Supplier', supplierId);
  return supplier;
}

export function getSupplier(state: DemoState, ctx: Context) {
  return { ...findSupplier(state, ctx.params[0]) };
}

function validTaxId(input: string): string {
  const taxId = normaliseTaxId(input);
  const problem = thaiTaxIdProblem(taxId);
  if (problem) {
    throw refused(
      'INVALID_TAX_ID',
      problem === 'NOT_13_DIGITS'
        ? 'A Thai tax identification number has 13 digits'
        : 'This tax identification number fails its check digit; one of its digits is mistyped',
      { problem },
    );
  }
  return taxId;
}

function contactInput(input: Input) {
  return {
    contactName: input.optionalText('contactName', { emptyIsNull: true, max: 120 }),
    phone: input.optionalText('phone', { emptyIsNull: true, max: 40 }),
    email: input.optionalText('email', { emptyIsNull: true, lower: true, email: true, max: 255 }),
    address: input.optionalText('address', { emptyIsNull: true, max: 500 }),
  };
}

export function createSupplier(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['code', 'name', 'taxId', ...CONTACT_FIELDS]);
  const code = input.text('code', {
    trim: true,
    upper: true,
    pattern: CODE_PATTERN,
    patternMessage: CODE_MESSAGE,
  });
  const name = input.text('name', { trim: true, notEmpty: true, max: 200 });
  const rawTaxId = input.text('taxId', { max: 32 });
  const contact = contactInput(input);
  input.done();

  const taxId = validTaxId(rawTaxId);
  if (state.suppliers.some((s) => s.code === code)) {
    throw conflict('SUPPLIER_CODE_TAKEN', `A supplier with code ${code} already exists`);
  }
  const at = new Date(ctx.now).toISOString();
  const supplier: SupplierRecord = {
    id: id(),
    code,
    name,
    taxId,
    contactName: contact.contactName ?? null,
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    address: contact.address ?? null,
    active: true,
    revision: 1,
    createdAt: at,
    updatedAt: at,
  };
  state.suppliers.push(supplier);
  return { ...supplier };
}

export function updateSupplier(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['revision', 'name', 'taxId', 'active', ...CONTACT_FIELDS]);
  const revision = input.int('revision', { min: 1 });
  const name = input.optionalText('name', { trim: true, notEmpty: true, max: 200 });
  const rawTaxId = input.optionalText('taxId', { max: 32 });
  const active = input.optionalBool('active');
  const contact = contactInput(input);
  input.done();

  const next: Partial<Record<keyof SupplierRecord, unknown>> = {
    name: name ?? undefined,
    taxId: typeof rawTaxId === 'string' ? validTaxId(rawTaxId) : undefined,
    ...contact,
    active,
  };
  const supplier = findSupplier(state, ctx.params[0]);
  if (supplier.revision !== revision) {
    throw conflict(
      'SUPPLIER_CHANGED',
      'This supplier was changed by someone else since you opened it. Reload it and try again.',
      { currentRevision: supplier.revision },
    );
  }
  const changes = Object.entries(next).filter(
    ([field, value]) => value !== undefined && value !== supplier[field as keyof SupplierRecord],
  );
  if (changes.length === 0) return { ...supplier };
  Object.assign(supplier, Object.fromEntries(changes), {
    revision: supplier.revision + 1,
    updatedAt: new Date(ctx.now).toISOString(),
  });
  return { ...supplier };
}

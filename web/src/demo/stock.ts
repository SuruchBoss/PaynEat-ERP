// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Stock on hand and opening balances in the demo API (#41, ADR-0021): drafts, posting a draft
 * into lots, reversing a posted document, and stock on hand as of a business date. Every rule
 * is the backend's own, imported from `ledger/domain/posting-rules.ts` and
 * `opening-balances/domain/opening-balance-rules.ts`; what is written here is the order the
 * backend's LedgerService and OpeningBalancesService apply them in — the document first, then
 * the plan, then the stock — and the codes they refuse with.
 */
import { parseDecimal, sign } from '@backend/src/core/quantity/domain/exact-decimal';
import {
  formatQuantity,
  normaliseDecimal,
  stockValue,
  sumValues,
} from '@backend/src/core/quantity/domain/stock-value';
import { compareDates, dateIn, isIsoDate } from '@backend/src/core/time/domain/business-date';
import {
  applyMovements,
  businessDateProblem,
  CONFLICT_RULES,
  lotNumber,
  netChanges,
  reversalMovements,
  reversalProblem,
  type LocationType,
  type Movement,
  type PostingRule,
} from '@backend/src/modules/ledger/domain/posting-rules';
import {
  lineProblem,
  locationProblem,
  postingRefusal,
} from '@backend/src/modules/opening-balances/domain/opening-balance-rules';
import { DemoError, Input, notFound, queryValue, refused, uuidParam, type Context } from './http';
import { unitDecimals } from './master-data';
import {
  DEMO_TIME_ZONE,
  id,
  type DemoState,
  type DocumentRecord,
  type EntryRecord,
  type ItemRecord,
  type LocationRecord,
  type OpeningBalanceLine,
  type OpeningBalanceRecord,
} from './state';

const today = (now: number) => dateIn(DEMO_TIME_ZONE, new Date(now));
const at = (now: number) => new Date(now).toISOString();
const isZero = (text: string) => sign(parseDecimal(text)!) === 0;

/** backend ledger.service.ts REFUSAL_MESSAGES: the console shows its own text by `rule`. */
const REFUSAL_MESSAGES: Record<PostingRule, string> = {
  already_posted: 'This document has already been posted',
  stale_revision:
    'This document was changed by someone else since you opened it. Reload it and try again.',
  empty_document: 'A document with no lines cannot be posted',
  business_date_in_future: 'The business date cannot be later than today',
  inactive_location: 'The location is no longer in use',
  inactive_item: 'An item on this document is no longer in use',
  secondary_quantity_not_allowed: 'A piece count is recorded only for variable-weight items',
  expired_lot: 'A lot on this document had already expired on its business date',
  negative_stock_plant: 'Posting would take a lot below zero at a plant',
  negative_stock_warehouse: 'Posting would take a lot below zero at a warehouse',
  negative_stock_in_transit: 'Posting would take a lot below zero in transit',
  negative_stock_subcontractor: 'Posting would take a lot below zero at a subcontractor',
  not_posted: 'Only a posted document can be reversed',
  reversal_of_reversal: 'A reversal cannot be reversed; post the correct document instead',
  already_reversed: 'This document has already been reversed',
  business_date_before_original: 'A reversal cannot be dated before the document it reverses',
};

/** 422, or 409 when it lost a race with someone else (backend `PostingRefusedError`). */
function postingRefused(rule: PostingRule, details: Record<string, unknown> = {}): DemoError {
  return new DemoError(
    CONFLICT_RULES.has(rule) ? 409 : 422,
    'POSTING_REFUSED',
    REFUSAL_MESSAGES[rule],
    { rule, ...details },
  );
}

const invalidDate = (field: string) =>
  refused('INVALID_DATE', `${field} must be a real date written YYYY-MM-DD`, { field });

function assertBusinessDate(date: string, now: number): void {
  if (!isIsoDate(date)) throw invalidDate('businessDate');
  if (businessDateProblem(date, today(now))) {
    throw refused('BUSINESS_DATE_IN_FUTURE', 'The business date cannot be later than today');
  }
}

/** Gap-free numbers per type and year: OB-2026-00001, RV-2026-00001. */
function nextNumber(state: DemoState, prefix: 'OB' | 'RV', now: number): string {
  const year = today(now).slice(0, 4);
  const key = `${prefix}:${year}`;
  const next = (state.sequences.get(key) ?? 0) + 1;
  state.sequences.set(key, next);
  return `${prefix}-${year}-${String(next).padStart(5, '0')}`;
}

const movement = (entry: EntryRecord): Movement => ({
  ...entry,
  reversesEntryId: entry.reversesEntryId ?? undefined,
});

/** Each lot at each location as of the end of `asOf`: the ledger's entries, summed. */
function balances(state: DemoState, asOf?: string) {
  return netChanges(
    state.entries
      .filter((e) => asOf === undefined || compareDates(e.businessDate, asOf) <= 0)
      .map(movement),
  );
}

/**
 * Writes a document's entries, or refuses them with the ledger's rule: stock never goes below
 * zero anywhere but a branch (ADR-0003).
 */
function write(state: DemoState, entries: EntryRecord[]): void {
  const types = new Map<string, LocationType>(state.locations.map((l) => [l.id, l.type]));
  const result = applyMovements(balances(state), entries.map(movement), types);
  if (!result.ok) {
    throw postingRefused(result.rule, {
      lotId: result.lotId,
      locationCode: state.locations.find((l) => l.id === result.locationId)?.code,
      quantity: result.quantity,
    });
  }
  state.entries.push(...entries);
}

// --- Views -----------------------------------------------------------------------------------

function person(state: DemoState, userId: string | null) {
  const user = userId ? state.users.find((u) => u.id === userId) : undefined;
  return user ? { id: user.id, displayName: user.displayName } : null;
}

function documentView(state: DemoState, doc: DocumentRecord) {
  const reverses = doc.reversesId
    ? state.documents.find((d) => d.id === doc.reversesId)
    : undefined;
  const reversal = state.documents.find((d) => d.reversesId === doc.id);
  return {
    id: doc.id,
    number: doc.number,
    type: doc.type,
    status: doc.status,
    businessDate: doc.businessDate,
    note: doc.note,
    revision: doc.revision,
    createdBy: person(state, doc.createdById)!,
    createdAt: doc.createdAt,
    postedBy: person(state, doc.postedById),
    postedAt: doc.postedAt,
    reverses: reverses ? { id: reverses.id, number: reverses.number } : null,
    reversedBy: reversal
      ? {
          id: reversal.id,
          number: reversal.number,
          businessDate: reversal.businessDate,
          note: reversal.note,
          postedAt: reversal.postedAt!,
          postedBy: person(state, reversal.postedById)!,
        }
      : null,
  };
}

function locationRef(location: LocationRecord) {
  const { id: locationId, code, type, nameTh, nameEn } = location;
  return { id: locationId, code, type, nameTh, nameEn };
}

function lineView(state: DemoState, documentId: string, line: OpeningBalanceLine) {
  const item = state.items.find((i) => i.id === line.itemId)!;
  const lot = state.lots.find((l) => l.originDocumentId === documentId && l.lineNo === line.lineNo);
  return {
    lineNo: line.lineNo,
    item: {
      id: item.id,
      code: item.code,
      nameTh: item.nameTh,
      nameEn: item.nameEn,
      baseUnitCode: item.baseUnitCode,
      variableWeight: item.variableWeight,
    },
    quantity: formatQuantity(line.quantity, unitDecimals(item.baseUnitCode)),
    secondaryQuantity: line.secondaryQuantity,
    unitCost: line.unitCost,
    expiryDate: line.expiryDate,
    value: stockValue(line.quantity, line.unitCost),
    lot: lot ? { id: lot.id, number: lot.number } : null,
  };
}

function openingBalanceView(state: DemoState, record: OpeningBalanceRecord) {
  const doc = state.documents.find((d) => d.id === record.documentId)!;
  const location = state.locations.find((l) => l.id === record.locationId)!;
  const lines = record.lines.map((line) => lineView(state, doc.id, line));
  return {
    ...documentView(state, doc),
    location: locationRef(location),
    lines,
    totalValue: sumValues(lines.map((l) => l.value)),
  };
}

// --- Stock on hand (backend ledger.service.ts stockOnHand) -----------------------------------

export function stockOnHand(state: DemoState, ctx: Context) {
  const asOfInput = queryValue(ctx.query, 'asOf', { isoDate: true });
  const locationId = queryValue(ctx.query, 'locationId', { uuid: true });
  const itemId = queryValue(ctx.query, 'itemId', { uuid: true });
  const now = today(ctx.now);
  const asOf = asOfInput ?? now;
  if (!isIsoDate(asOf)) throw invalidDate('asOf');
  if (compareDates(asOf, now) > 0) {
    throw refused(
      'AS_OF_IN_FUTURE',
      'Stock on hand is known up to today, not for a date still to come',
    );
  }

  const rows = balances(state, asOf)
    .filter((b) => !locationId || b.locationId === locationId)
    .filter((b) => !itemId || b.itemId === itemId)
    .filter((b) => !isZero(b.quantity) || !isZero(b.secondaryQuantity ?? '0'))
    .map((balance) => {
      const lot = state.lots.find((l) => l.id === balance.lotId)!;
      const item = state.items.find((i) => i.id === balance.itemId)!;
      const location = state.locations.find((l) => l.id === balance.locationId)!;
      return {
        item: {
          id: item.id,
          code: item.code,
          nameTh: item.nameTh,
          nameEn: item.nameEn,
          baseUnitCode: item.baseUnitCode,
        },
        lot: { id: lot.id, number: lot.number, expiryDate: lot.expiryDate },
        location: locationRef(location),
        quantity: formatQuantity(balance.quantity, unitDecimals(item.baseUnitCode)),
        secondaryQuantity:
          balance.secondaryQuantity === null ? null : formatQuantity(balance.secondaryQuantity, 0),
        unitCost: lot.unitCost,
        value: stockValue(balance.quantity, lot.unitCost),
        expired: compareDates(lot.expiryDate, asOf) < 0,
      };
    })
    .sort(
      (a, b) =>
        a.location.code.localeCompare(b.location.code) ||
        a.item.code.localeCompare(b.item.code) ||
        a.lot.expiryDate.localeCompare(b.lot.expiryDate) ||
        a.lot.number.localeCompare(b.lot.number),
    );
  return { asOf, rows, totalValue: sumValues(rows.map((r) => r.value)) };
}

// --- Opening balances (backend opening-balances.service.ts) ----------------------------------

const NOTE_MAX = 500;
const LINES_MAX = 200;
const LINE_FIELDS = ['itemId', 'quantity', 'secondaryQuantity', 'unitCost', 'expiryDate'];

interface LineInput {
  itemId: string;
  quantity: string;
  secondaryQuantity: string | null;
  unitCost: string;
  expiryDate: string;
}

function linesInput(input: Input, optional: boolean): LineInput[] | undefined {
  return input.list('lines', { max: LINES_MAX, optional }, (element, prefix, problems) => {
    const line = new Input(element, LINE_FIELDS, prefix, problems);
    return {
      itemId: line.text('itemId', { uuid: true }),
      quantity: line.text('quantity', { trim: true, max: 40 }),
      secondaryQuantity: line.optionalText('secondaryQuantity', { trim: true, max: 40 }) ?? null,
      unitCost: line.text('unitCost', { trim: true, max: 40 }),
      expiryDate: line.text('expiryDate', { isoDate: true }),
    };
  });
}

/** backend opening-balances.service.ts LOCATION_ERRORS. */
const LOCATION_ERRORS = {
  LOCATION_SYSTEM_MANAGED:
    'An opening balance is kept at a plant, warehouse or branch, never in transit',
  LOCATION_INACTIVE: 'This location is no longer in use',
} as const;

function usableLocation(state: DemoState, locationId: string): LocationRecord {
  const location = state.locations.find((l) => l.id === locationId);
  if (!location) throw refused('UNKNOWN_LOCATION', `There is no location '${locationId}'`);
  const problem = locationProblem(location);
  if (problem) throw refused('LOCATION_NOT_ALLOWED', LOCATION_ERRORS[problem], { problem });
  return location;
}

/** Each line checked against its item; the first problem is refused, naming its line. */
function validLines(state: DemoState, lines: LineInput[]): OpeningBalanceLine[] {
  return lines.map((input, index) => {
    const lineNo = index + 1;
    const item: ItemRecord | undefined = state.items.find((i) => i.id === input.itemId);
    if (!item) throw refused('UNKNOWN_ITEM', `There is no item '${input.itemId}'`, { lineNo });
    if (!item.active)
      throw refused('ITEM_INACTIVE', `${item.code} is no longer in use`, { lineNo });
    const problem = lineProblem(input, {
      variableWeight: item.variableWeight,
      baseUnitDecimals: unitDecimals(item.baseUnitCode),
    });
    if (problem) {
      throw refused(
        'INVALID_OPENING_BALANCE_LINE',
        `Line ${lineNo} (${item.code}) is not valid: ${problem}`,
        { lineNo, problem },
      );
    }
    // Stored as the database keeps a numeric: without trailing zeros.
    return {
      lineNo,
      itemId: item.id,
      quantity: normaliseDecimal(input.quantity),
      secondaryQuantity:
        input.secondaryQuantity === null ? null : normaliseDecimal(input.secondaryQuantity),
      unitCost: normaliseDecimal(input.unitCost),
      expiryDate: input.expiryDate,
    };
  });
}

function findOpeningBalance(state: DemoState, documentId: string): OpeningBalanceRecord {
  const record = state.openingBalances.find((r) => r.documentId === uuidParam(documentId));
  if (!record) throw notFound('Opening balance', documentId);
  return record;
}

export function listOpeningBalances(state: DemoState, ctx: Context) {
  const status = queryValue(ctx.query, 'status', { oneOf: ['draft', 'posted', 'all'] }) ?? 'all';
  const locationId = queryValue(ctx.query, 'locationId', { uuid: true });
  return state.openingBalances
    .filter((r) => !locationId || r.locationId === locationId)
    .map((record) => {
      const { lines, ...view } = openingBalanceView(state, record);
      return { ...view, lineCount: lines.length };
    })
    .filter((summary) => status === 'all' || summary.status === status)
    .sort((a, b) => b.number.localeCompare(a.number));
}

export function getOpeningBalance(state: DemoState, ctx: Context) {
  return openingBalanceView(state, findOpeningBalance(state, ctx.params[0]));
}

export function createOpeningBalance(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['locationId', 'businessDate', 'note', 'lines']);
  const locationId = input.text('locationId', { uuid: true });
  const businessDate = input.optionalText('businessDate', { isoDate: true });
  const note = input.optionalText('note', { emptyIsNull: true, max: NOTE_MAX });
  const lines = linesInput(input, false)!;
  input.done();

  const location = usableLocation(state, locationId);
  const stored = validLines(state, lines);
  const date = businessDate ?? today(ctx.now);
  assertBusinessDate(date, ctx.now);
  const doc: DocumentRecord = {
    id: id(),
    number: nextNumber(state, 'OB', ctx.now),
    type: 'opening_balance',
    status: 'draft',
    businessDate: date,
    note: note ?? null,
    revision: 1,
    createdById: ctx.actor!.id,
    createdAt: at(ctx.now),
    postedById: null,
    postedAt: null,
    reversesId: null,
  };
  const record = { documentId: doc.id, locationId: location.id, lines: stored };
  state.documents.push(doc);
  state.openingBalances.push(record);
  return openingBalanceView(state, record);
}

/** Locks a draft at the revision the editor opened; a posted document never changes. */
function lockDraft(doc: DocumentRecord, revision: number): void {
  if (doc.status === 'posted') {
    throw new DemoError(
      409,
      'DOCUMENT_POSTED',
      'A posted document cannot be edited. Reverse it and post a corrected one.',
    );
  }
  if (doc.revision !== revision) {
    throw new DemoError(
      409,
      'DOCUMENT_CHANGED',
      'This document was changed by someone else since you opened it. Reload it and try again.',
      { currentRevision: doc.revision },
    );
  }
}

export function updateOpeningBalance(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['revision', 'locationId', 'businessDate', 'note', 'lines']);
  const revision = input.int('revision', { min: 1 });
  const locationId = input.optionalText('locationId', { uuid: true });
  const businessDate = input.optionalText('businessDate', { isoDate: true });
  const note = input.optionalText('note', { emptyIsNull: true, max: NOTE_MAX });
  const lines = linesInput(input, true);
  input.done();

  const record = findOpeningBalance(state, ctx.params[0]);
  const location = locationId ? usableLocation(state, locationId) : undefined;
  const stored = lines ? validLines(state, lines) : undefined;
  const doc = state.documents.find((d) => d.id === record.documentId)!;
  lockDraft(doc, revision);
  if (businessDate) assertBusinessDate(businessDate, ctx.now);

  if (businessDate) doc.businessDate = businessDate;
  if (note !== undefined) doc.note = note;
  doc.revision += 1;
  if (location) record.locationId = location.id;
  if (stored) record.lines = stored;
  return openingBalanceView(state, record);
}

/** backend opening-balance-rules.ts postingRefusal, then the ledger's own checks. */
export function postOpeningBalance(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['revision']);
  const revision = input.int('revision', { min: 1 });
  input.done();

  const record = findOpeningBalance(state, ctx.params[0]);
  const doc = state.documents.find((d) => d.id === record.documentId)!;
  if (doc.status === 'posted') throw postingRefused('already_posted');
  if (doc.revision !== revision) {
    throw postingRefused('stale_revision', { currentRevision: doc.revision });
  }
  const location = state.locations.find((l) => l.id === record.locationId)!;
  const refusal = postingRefusal(
    {
      businessDate: doc.businessDate,
      location,
      lines: record.lines.map((line) => ({
        ...line,
        item: state.items.find((i) => i.id === line.itemId)!,
      })),
    },
    today(ctx.now),
  );
  if (refusal) {
    throw postingRefused(
      refusal.rule,
      refusal.lineNo === undefined ? {} : { lineNo: refusal.lineNo },
    );
  }
  const dateRule = businessDateProblem(doc.businessDate, today(ctx.now));
  if (dateRule) throw postingRefused(dateRule);

  const lots = record.lines.map((line) => ({
    id: id(),
    number: lotNumber(doc.number, line.lineNo),
    itemId: line.itemId,
    originDocumentId: doc.id,
    lineNo: line.lineNo,
    unitCost: line.unitCost,
    expiryDate: line.expiryDate,
  }));
  write(
    state,
    record.lines.map((line, index) => ({
      id: id(),
      documentId: doc.id,
      lineNo: line.lineNo,
      itemId: line.itemId,
      lotId: lots[index].id,
      locationId: location.id,
      quantity: line.quantity,
      secondaryQuantity: line.secondaryQuantity,
      unitCost: line.unitCost,
      businessDate: doc.businessDate,
      reversesEntryId: null,
    })),
  );
  state.lots.push(...lots);
  doc.status = 'posted';
  doc.postedById = ctx.actor!.id;
  doc.postedAt = at(ctx.now);
  doc.revision += 1;
  markFirstUse(location, `posted document ${doc.number}`, ctx.now);
  return openingBalanceView(state, record);
}

/** The first posted document to name a location fixes its code. */
function markFirstUse(location: LocationRecord, use: string, now: number): void {
  if (location.firstUsedAt) return;
  location.firstUsedAt = at(now);
  location.firstUse = use;
}

/** A new, posted reversal whose entries negate the original's exactly; only once. */
export function reverseOpeningBalance(state: DemoState, ctx: Context) {
  const input = new Input(ctx.body, ['businessDate', 'note']);
  const businessDateInput = input.optionalText('businessDate', { isoDate: true });
  const note = input.optionalText('note', { emptyIsNull: true, max: NOTE_MAX });
  input.done();

  const record = findOpeningBalance(state, ctx.params[0]);
  const original = state.documents.find((d) => d.id === record.documentId)!;
  const now = today(ctx.now);
  const businessDate = businessDateInput ?? now;
  if (!isIsoDate(businessDate)) throw invalidDate('businessDate');
  const reversedBy = state.documents.find((d) => d.reversesId === original.id);
  const rule = reversalProblem(
    { ...original, reversedBy: reversedBy?.number ?? null },
    businessDate,
    now,
  );
  if (rule) throw postingRefused(rule);

  const reversal: DocumentRecord = {
    id: id(),
    number: nextNumber(state, 'RV', ctx.now),
    type: 'reversal',
    status: 'posted',
    businessDate,
    note: note ?? null,
    revision: 1,
    createdById: ctx.actor!.id,
    createdAt: at(ctx.now),
    postedById: ctx.actor!.id,
    postedAt: at(ctx.now),
    reversesId: original.id,
  };
  const originalEntries = state.entries.filter((e) => e.documentId === original.id);
  const entries: EntryRecord[] = reversalMovements(originalEntries).map((m) => ({
    ...m,
    id: id(),
    documentId: reversal.id,
    businessDate,
    reversesEntryId: m.reversesEntryId ?? null,
  }));
  write(state, entries);
  state.documents.push(reversal);
  return openingBalanceView(state, record);
}

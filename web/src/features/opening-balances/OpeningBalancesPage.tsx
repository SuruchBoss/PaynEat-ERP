// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listItems, listUnits, unitName, type ItemView } from '@/features/items/items.api';
import { listLocations } from '@/features/locations/locations.api';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import type { ApiError } from '@/lib/api-error';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  createOpeningBalance,
  getOpeningBalance,
  listOpeningBalances,
  postOpeningBalance,
  reverseOpeningBalance,
  updateOpeningBalance,
  type DocumentHeader,
  type OpeningBalanceView,
} from './opening-balances.api';

/** Kept as a key, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const ERRORS: Record<string, MessageKey> = {
  DOCUMENT_CHANGED: 'openingBalances.error.changed',
  DOCUMENT_POSTED: 'openingBalances.error.posted',
  UNKNOWN_LOCATION: 'openingBalances.error.location',
  BUSINESS_DATE_IN_FUTURE: 'openingBalances.error.futureDate',
  INVALID_DATE: 'openingBalances.error.date',
  VALIDATION_FAILED: 'openingBalances.error.invalid',
};

/** Why the ledger refused a posting or a reversal, by its rule (backend `posting-rules.ts`). */
const RULES: Record<string, MessageKey> = {
  already_posted: 'openingBalances.rule.already_posted',
  stale_revision: 'openingBalances.rule.stale_revision',
  empty_document: 'openingBalances.rule.empty_document',
  business_date_in_future: 'openingBalances.rule.business_date_in_future',
  inactive_location: 'openingBalances.rule.inactive_location',
  inactive_item: 'openingBalances.rule.inactive_item',
  secondary_quantity_not_allowed: 'openingBalances.rule.secondary_quantity_not_allowed',
  expired_lot: 'openingBalances.rule.expired_lot',
  negative_stock_plant: 'openingBalances.rule.negative_stock',
  negative_stock_warehouse: 'openingBalances.rule.negative_stock',
  negative_stock_in_transit: 'openingBalances.rule.negative_stock',
  not_posted: 'openingBalances.rule.not_posted',
  already_reversed: 'openingBalances.rule.already_reversed',
  business_date_before_original: 'openingBalances.rule.business_date_before_original',
};

/** What is wrong with one line, by the problem the API names (backend `opening-balance-rules.ts`). */
const LINE_PROBLEMS: Record<string, MessageKey> = {
  QUANTITY_NOT_A_NUMBER: 'openingBalances.line.quantityNumber',
  QUANTITY_NOT_POSITIVE: 'openingBalances.line.quantityPositive',
  QUANTITY_TOO_PRECISE: 'openingBalances.line.quantityPrecise',
  QUANTITY_TOO_LARGE: 'openingBalances.line.tooLarge',
  SECONDARY_QUANTITY_NOT_ALLOWED: 'openingBalances.line.piecesNotAllowed',
  SECONDARY_QUANTITY_INVALID: 'openingBalances.line.piecesInvalid',
  UNIT_COST_NOT_A_NUMBER: 'openingBalances.line.costNumber',
  UNIT_COST_NEGATIVE: 'openingBalances.line.costNegative',
  UNIT_COST_TOO_PRECISE: 'openingBalances.line.costPrecise',
  UNIT_COST_TOO_LARGE: 'openingBalances.line.tooLarge',
  EXPIRY_NOT_A_DATE: 'openingBalances.line.expiry',
};

const LOCATION_PROBLEMS: Record<string, MessageKey> = {
  LOCATION_SYSTEM_MANAGED: 'openingBalances.error.locationInTransit',
  LOCATION_INACTIVE: 'openingBalances.error.locationInactive',
};

function detail(error: ApiError, name: string): unknown {
  const details = error.details as Record<string, unknown> | undefined;
  return details?.[name];
}

/** The messages that depend on an error's details: the rule, the line, the problem. */
function describeError(error: ApiError): { key: MessageKey; params?: MessageParams } | undefined {
  const lineNo = Number(detail(error, 'lineNo') ?? 0);
  switch (error.code) {
    case 'POSTING_REFUSED': {
      const key = RULES[String(detail(error, 'rule'))];
      if (!key) return undefined;
      return { key, params: { lineNo, location: String(detail(error, 'locationCode') ?? '') } };
    }
    case 'INVALID_OPENING_BALANCE_LINE': {
      const key = LINE_PROBLEMS[String(detail(error, 'problem'))];
      return key ? { key, params: { lineNo } } : undefined;
    }
    case 'UNKNOWN_ITEM':
    case 'ITEM_INACTIVE':
      return { key: 'openingBalances.line.item', params: { lineNo } };
    case 'LOCATION_NOT_ALLOWED': {
      const key = LOCATION_PROBLEMS[String(detail(error, 'problem'))];
      return key ? { key } : undefined;
    }
    default:
      return undefined;
  }
}

function StatusBadge({ doc }: { doc: DocumentHeader }) {
  const { t } = useI18n();
  if (doc.reversedBy) {
    return (
      <span className="badge badge--down">
        {t('openingBalances.status.reversed', { number: doc.reversedBy.number })}
      </span>
    );
  }
  return doc.status === 'posted' ? (
    <span className="badge badge--up">{t('openingBalances.status.posted')}</span>
  ) : (
    <span className="badge badge--neutral">{t('openingBalances.status.draft')}</span>
  );
}

/**
 * Opening balances (#7): the stock that already exists when a location starts using the
 * ERP. A draft is edited freely and affects nothing; posting turns every line into a lot in
 * one go; a mistake is corrected by a reversal, never an edit. Everyone signed in reads them;
 * the plant role drafts, posts and reverses.
 */
export function OpeningBalancesPage() {
  const { t, language } = useI18n();
  const canManage = useAuthStore((s) =>
    s.user?.permissions.includes(Permission.OPENING_BALANCE_MANAGE),
  );
  const documents = useQuery({ queryKey: qk.openingBalances, queryFn: listOpeningBalances });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <section className="page page--wide" aria-labelledby="opening-balances-title">
      <div className="page__header">
        <div>
          <h1 id="opening-balances-title">{t('openingBalances.title')}</h1>
          <p className="muted">{t('openingBalances.intro')}</p>
        </div>
        {canManage && !creating && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setOpenId(null);
              setNotice(null);
            }}
          >
            {t('openingBalances.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}
        </p>
      )}

      {creating && (
        <DraftForm
          onClose={() => setCreating(false)}
          onSaved={(doc, n) => {
            setCreating(false);
            setOpenId(doc.id);
            setNotice(n);
          }}
        />
      )}
      {openId && (
        <DocumentPanel
          key={openId}
          id={openId}
          canManage={Boolean(canManage)}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      {documents.isPending && (
        <p className="muted" role="status">
          {t('openingBalances.loading')}
        </p>
      )}
      {documents.isError && <ErrorCallout error={documents.error} />}

      {documents.data && (
        <>
          <p className="subtle" role="status">
            {t('openingBalances.count', { count: documents.data.length })}
          </p>
          {documents.data.length === 0 ? (
            <p className="muted">{t('openingBalances.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('openingBalances.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('openingBalances.column.number')}</th>
                    <th scope="col">{t('openingBalances.column.location')}</th>
                    <th scope="col">{t('openingBalances.column.businessDate')}</th>
                    <th scope="col" className="numeric">
                      {t('openingBalances.column.lines')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('openingBalances.column.value')}
                    </th>
                    <th scope="col">{t('openingBalances.column.status')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('openingBalances.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {documents.data.map((doc) => (
                    <tr key={doc.id}>
                      <th scope="row">
                        <code>{doc.number}</code>
                      </th>
                      <td>
                        <span className="cell-title">{nameOf(doc.location)}</span>
                        <span className="subtle">
                          <code>{doc.location.code}</code>
                        </span>
                      </td>
                      <td className="nowrap">{formatBusinessDate(doc.businessDate, language)}</td>
                      <td className="numeric">{doc.lineCount}</td>
                      <td className="numeric nowrap">{groupDigits(doc.totalValue)}</td>
                      <td>
                        <StatusBadge doc={doc} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('openingBalances.open.label', { number: doc.number })}
                          aria-expanded={openId === doc.id}
                          onClick={() => {
                            setOpenId(openId === doc.id ? null : doc.id);
                            setCreating(false);
                            setNotice(null);
                          }}
                        >
                          {t('openingBalances.open.short')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** One document: its draft form, or what was posted and how it can be reversed. */
function DocumentPanel({
  id,
  canManage,
  onClose,
  onNotice,
}: {
  id: string;
  canManage: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t } = useI18n();
  const doc = useQuery({ queryKey: qk.openingBalance(id), queryFn: () => getOpeningBalance(id) });

  if (doc.isPending) {
    return (
      <p className="muted" role="status">
        {t('openingBalances.loadingOne')}
      </p>
    );
  }
  if (doc.isError) return <ErrorCallout error={doc.error} />;
  if (doc.data.status === 'draft' && canManage) {
    return (
      <DraftForm
        key={doc.data.revision}
        doc={doc.data}
        onClose={onClose}
        onSaved={(_saved, notice) => onNotice(notice)}
      />
    );
  }
  return (
    <PostedDocument doc={doc.data} canManage={canManage} onClose={onClose} onNotice={onNotice} />
  );
}

interface LineState {
  key: number;
  itemId: string;
  quantity: string;
  secondaryQuantity: string;
  unitCost: string;
  expiryDate: string;
}

let nextLineKey = 1;
const blankLine = (): LineState => ({
  key: nextLineKey++,
  itemId: '',
  quantity: '',
  secondaryQuantity: '',
  unitCost: '',
  expiryDate: '',
});

/** A new draft, or a saved one to edit and post. */
function DraftForm({
  doc,
  onClose,
  onSaved,
}: {
  doc?: OpeningBalanceView;
  onClose: () => void;
  onSaved: (doc: OpeningBalanceView, notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const [locationId, setLocationId] = useState(doc?.location.id ?? '');
  const [businessDate, setBusinessDate] = useState(doc?.businessDate ?? '');
  const [note, setNote] = useState(doc?.note ?? '');
  const [lines, setLines] = useState<LineState[]>(
    doc && doc.lines.length > 0
      ? doc.lines.map((line) => ({
          key: nextLineKey++,
          itemId: line.item.id,
          quantity: line.quantity,
          secondaryQuantity: line.secondaryQuantity ?? '',
          unitCost: line.unitCost,
          expiryDate: line.expiryDate,
        }))
      : [blankLine()],
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => headingRef.current?.focus(), []);

  const itemById = new Map((items.data ?? []).map((item) => [item.id, item]));
  const stockable = (locations.data ?? []).filter(
    (l) => l.active && (l.type === 'plant' || l.type === 'warehouse' || l.type === 'branch'),
  );
  const choosable = (current: string): ItemView[] =>
    (items.data ?? []).filter((item) => item.active || item.id === current);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const setLine = (key: number, change: Partial<LineState>) =>
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.openingBalances });
    await queryClient.invalidateQueries({ queryKey: qk.stockOnHandAll });
  };

  const input = () => ({
    locationId,
    ...(businessDate ? { businessDate } : {}),
    note: note.trim(),
    lines: lines
      .filter((line) => line.itemId || line.quantity || line.unitCost || line.expiryDate)
      .map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity.trim(),
        secondaryQuantity:
          itemById.get(line.itemId)?.variableWeight && line.secondaryQuantity.trim()
            ? line.secondaryQuantity.trim()
            : null,
        unitCost: line.unitCost.trim(),
        expiryDate: line.expiryDate,
      })),
  });

  const save = useMutation({
    mutationFn: () =>
      doc ? updateOpeningBalance(doc.id, doc.revision, input()) : createOpeningBalance(input()),
    onSuccess: async (saved) => {
      await refresh();
      onSaved(saved, {
        key: doc ? 'openingBalances.saved' : 'openingBalances.created',
        params: { number: saved.number },
      });
    },
  });

  const post = useMutation({
    mutationFn: () => postOpeningBalance(doc!.id, doc!.revision),
    onSuccess: async (posted) => {
      await refresh();
      onSaved(posted, {
        key: 'openingBalances.posted',
        params: { number: posted.number, count: posted.lines.length },
      });
    },
    onSettled: () => setConfirming(false),
  });

  const busy = save.isPending || post.isPending;
  const titleId = doc ? 'draft-title' : 'new-draft-title';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    post.reset();
    save.mutate();
  };

  return (
    <form className="panel" onSubmit={submit} aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {doc
          ? t('openingBalances.draft.title', { number: doc.number })
          : t('openingBalances.create.title')}
      </h2>
      <p className="subtle">{t('openingBalances.draft.hint')}</p>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="ob-location">{t('openingBalances.field.location')}</label>
          <select
            id="ob-location"
            required
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">{t('openingBalances.field.chooseLocation')}</option>
            {stockable.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {nameOf(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ob-business-date">{t('openingBalances.field.businessDate')}</label>
          <input
            id="ob-business-date"
            type="date"
            aria-describedby="ob-business-date-hint"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
          />
          <p id="ob-business-date-hint" className="subtle">
            {t('openingBalances.field.businessDateHint')}
          </p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="ob-note">{t('openingBalances.field.note')}</label>
        <textarea
          id="ob-note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <fieldset className="document-lines">
        <legend>{t('openingBalances.lines.legend')}</legend>
        <p className="subtle">{t('openingBalances.lines.intro')}</p>
        {lines.map((line, index) => {
          const n = index + 1;
          const item = itemById.get(line.itemId);
          const base = item ? unitName(units.data ?? [], item.baseUnitCode, language) : '';
          return (
            <div key={line.key} className="document-line">
              <div className="field">
                <label htmlFor={`ob-item-${line.key}`}>
                  {t('openingBalances.line.itemLabel', { n })}
                </label>
                <select
                  id={`ob-item-${line.key}`}
                  value={line.itemId}
                  onChange={(e) =>
                    setLine(line.key, { itemId: e.target.value, secondaryQuantity: '' })
                  }
                >
                  <option value="">{t('openingBalances.line.chooseItem')}</option>
                  {choosable(line.itemId).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code} · {nameOf(i)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`ob-quantity-${line.key}`}>
                  {base
                    ? t('openingBalances.line.quantityIn', { n, unit: base })
                    : t('openingBalances.line.quantityLabel', { n })}
                </label>
                <input
                  id={`ob-quantity-${line.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.quantity}
                  onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                />
              </div>
              {item?.variableWeight && (
                <div className="field">
                  <label htmlFor={`ob-pieces-${line.key}`}>
                    {t('openingBalances.line.piecesLabel', { n })}
                  </label>
                  <input
                    id={`ob-pieces-${line.key}`}
                    inputMode="numeric"
                    autoComplete="off"
                    value={line.secondaryQuantity}
                    onChange={(e) => setLine(line.key, { secondaryQuantity: e.target.value })}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor={`ob-cost-${line.key}`}>
                  {base
                    ? t('openingBalances.line.costPer', { n, unit: base })
                    : t('openingBalances.line.costLabel', { n })}
                </label>
                <input
                  id={`ob-cost-${line.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.unitCost}
                  onChange={(e) => setLine(line.key, { unitCost: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`ob-expiry-${line.key}`}>
                  {t('openingBalances.line.expiryLabel', { n })}
                </label>
                <input
                  id={`ob-expiry-${line.key}`}
                  type="date"
                  value={line.expiryDate}
                  onChange={(e) => setLine(line.key, { expiryDate: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="button button--ghost button--small"
                aria-label={t('openingBalances.line.removeLabel', { n })}
                onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
              >
                {t('openingBalances.line.remove')}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setLines((all) => [...all, blankLine()])}
        >
          {t('openingBalances.line.add')}
        </button>
      </fieldset>

      {save.isError && (
        <ErrorCallout error={save.error} messages={ERRORS} describe={describeError} />
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {save.isPending ? t('openingBalances.saving') : t('openingBalances.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t(doc ? 'openingBalances.close' : 'openingBalances.cancel')}
        </button>
      </div>

      {doc && (
        <div className="panel__footer">
          {confirming ? (
            <div className="callout" role="group" aria-labelledby="post-confirm-text">
              <p id="post-confirm-text">
                {t('openingBalances.post.confirm', {
                  number: doc.number,
                  count: doc.lines.length,
                  value: groupDigits(doc.totalValue),
                })}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => post.mutate()}
                >
                  {post.isPending
                    ? t('openingBalances.post.posting')
                    : t('openingBalances.post.yes')}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setConfirming(false)}
                >
                  {t('openingBalances.post.no')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => {
                save.reset();
                setConfirming(true);
              }}
            >
              {t('openingBalances.post.open')}
            </button>
          )}
          <p className="subtle">{t('openingBalances.post.hint')}</p>
          {post.isError && (
            <ErrorCallout error={post.error} messages={ERRORS} describe={describeError} />
          )}
        </div>
      )}
    </form>
  );
}

/** A posted document: its lines and the lots they became, and its reversal. */
function PostedDocument({
  doc,
  canManage,
  onClose,
  onNotice,
}: {
  doc: OpeningBalanceView;
  canManage: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const [reverseDate, setReverseDate] = useState('');
  const [reverseNote, setReverseNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  useEffect(() => headingRef.current?.focus(), []);

  const reverse = useMutation({
    mutationFn: () => reverseOpeningBalance(doc.id, reverseDate, reverseNote.trim()),
    onSuccess: async (reversed) => {
      await queryClient.invalidateQueries({ queryKey: qk.openingBalances });
      await queryClient.invalidateQueries({ queryKey: qk.stockOnHandAll });
      onNotice({
        key: 'openingBalances.reversed',
        params: { number: reversed.number, reversal: reversed.reversedBy?.number ?? '' },
      });
    },
    onSettled: () => setConfirming(false),
  });

  return (
    <section className="panel" aria-labelledby="posted-title">
      <h2 id="posted-title" ref={headingRef} tabIndex={-1}>
        {t('openingBalances.view.title', { number: doc.number })} <StatusBadge doc={doc} />
      </h2>
      <dl className="facts">
        <div>
          <dt>{t('openingBalances.column.location')}</dt>
          <dd>
            {nameOf(doc.location)} <code>{doc.location.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t('openingBalances.column.businessDate')}</dt>
          <dd>{formatBusinessDate(doc.businessDate, language)}</dd>
        </div>
        {doc.postedAt && doc.postedBy && (
          <div>
            <dt>{t('openingBalances.view.posted')}</dt>
            <dd>
              {t('openingBalances.view.by', {
                name: doc.postedBy.displayName,
                time: formatDateTime(doc.postedAt, language),
              })}
            </dd>
          </div>
        )}
        {doc.note && (
          <div>
            <dt>{t('openingBalances.field.note')}</dt>
            <dd>{doc.note}</dd>
          </div>
        )}
      </dl>

      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">
            {t('openingBalances.view.caption', { number: doc.number })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('openingBalances.column.item')}</th>
              <th scope="col">{t('openingBalances.column.lot')}</th>
              <th scope="col" className="numeric">
                {t('stock.column.quantity')}
              </th>
              <th scope="col" className="numeric">
                {t('stock.column.pieces')}
              </th>
              <th scope="col" className="numeric">
                {t('stock.column.unitCost')}
              </th>
              <th scope="col" className="numeric">
                {t('stock.column.value')}
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line) => (
              <tr key={line.lineNo}>
                <th scope="row">
                  <span className="cell-title">{nameOf(line.item)}</span>
                  <span className="subtle">
                    <code>{line.item.code}</code>
                  </span>
                </th>
                <td>
                  {line.lot ? <code>{line.lot.number}</code> : t('openingBalances.view.noLot')}
                  <span className="subtle">
                    {t('stock.expires', { date: formatBusinessDate(line.expiryDate, language) })}
                  </span>
                </td>
                <td className="numeric nowrap">
                  {groupDigits(line.quantity)}{' '}
                  {unitName(units.data ?? [], line.item.baseUnitCode, language)}
                </td>
                <td className="numeric nowrap">
                  {line.secondaryQuantity === null
                    ? t('stock.noPieces')
                    : t('stock.pieces', { count: groupDigits(line.secondaryQuantity) })}
                </td>
                <td className="numeric nowrap">{groupDigits(line.unitCost)}</td>
                <td className="numeric nowrap">{groupDigits(line.value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={5}>
                {t('stock.total')}
              </th>
              <td className="numeric nowrap">
                <strong>{groupDigits(doc.totalValue)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {doc.reversedBy ? (
        <p className="callout">
          {t('openingBalances.view.reversedBy', {
            number: doc.reversedBy.number,
            date: formatBusinessDate(doc.reversedBy.businessDate, language),
            name: doc.reversedBy.postedBy.displayName,
          })}
          {doc.reversedBy.note && <span className="subtle"> · {doc.reversedBy.note}</span>}
        </p>
      ) : (
        canManage &&
        doc.status === 'posted' && (
          <div className="panel__footer">
            <h3>{t('openingBalances.reverse.title')}</h3>
            <p className="subtle">{t('openingBalances.reverse.hint')}</p>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="reverse-date">{t('openingBalances.reverse.date')}</label>
                <input
                  id="reverse-date"
                  type="date"
                  aria-describedby="reverse-date-hint"
                  value={reverseDate}
                  onChange={(e) => setReverseDate(e.target.value)}
                />
                <p id="reverse-date-hint" className="subtle">
                  {t('openingBalances.reverse.dateHint')}
                </p>
              </div>
              <div className="field">
                <label htmlFor="reverse-note">{t('openingBalances.reverse.note')}</label>
                <input
                  id="reverse-note"
                  maxLength={500}
                  value={reverseNote}
                  onChange={(e) => setReverseNote(e.target.value)}
                />
              </div>
            </div>
            {confirming ? (
              <div className="callout" role="group" aria-labelledby="reverse-confirm-text">
                <p id="reverse-confirm-text">
                  {t('openingBalances.reverse.confirm', { number: doc.number })}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    disabled={reverse.isPending}
                    onClick={() => reverse.mutate()}
                  >
                    {reverse.isPending
                      ? t('openingBalances.reverse.reversing')
                      : t('openingBalances.reverse.yes')}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setConfirming(false)}
                  >
                    {t('openingBalances.post.no')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  reverse.reset();
                  setConfirming(true);
                }}
              >
                {t('openingBalances.reverse.open')}
              </button>
            )}
            {reverse.isError && (
              <ErrorCallout error={reverse.error} messages={ERRORS} describe={describeError} />
            )}
          </div>
        )
      )}
      <div className="actions">
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('openingBalances.close')}
        </button>
      </div>
    </section>
  );
}

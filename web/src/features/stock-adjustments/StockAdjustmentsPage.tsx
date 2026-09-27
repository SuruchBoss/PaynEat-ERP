// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listItems, listUnits, unitName } from '@/features/items/items.api';
import { listLocations } from '@/features/locations/locations.api';
import { stockOnHand } from '@/features/stock/stock.api';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import type { ApiError } from '@/lib/api-error';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  approveAdjustment,
  createAdjustment,
  getAdjustment,
  listAdjustments,
  postAdjustment,
  rejectAdjustment,
  submitAdjustment,
  updateAdjustment,
  type AdjustmentHeader,
  type AdjustmentView,
  type ApprovedView,
} from './stock-adjustments.api';

/** Kept as a key, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
  tone: 'success' | 'warning';
  /** A second sentence: why the ledger did not post an approved adjustment. */
  detail?: { key: MessageKey; params: MessageParams };
}

const ERRORS: Record<string, MessageKey> = {
  DOCUMENT_CHANGED: 'adjustments.error.changed',
  DOCUMENT_NOT_DRAFT: 'adjustments.error.notDraft',
  STEP_NOT_ALLOWED: 'adjustments.error.step',
  UNKNOWN_LOCATION: 'adjustments.error.location',
  BUSINESS_DATE_IN_FUTURE: 'adjustments.error.futureDate',
  INVALID_DATE: 'adjustments.error.date',
  VALIDATION_FAILED: 'adjustments.error.invalid',
  REJECTION_REASON_MISSING: 'adjustments.error.rejectionReason',
};

/** Why posting (or approving) was refused, by its rule (backend `posting-rules.ts`). */
const RULES: Record<string, MessageKey> = {
  already_posted: 'adjustments.rule.already_posted',
  stale_revision: 'adjustments.rule.stale_revision',
  not_approved: 'adjustments.rule.not_approved',
  self_approval: 'adjustments.rule.self_approval',
  empty_document: 'adjustments.rule.empty_document',
  business_date_in_future: 'adjustments.rule.business_date_in_future',
  inactive_location: 'adjustments.rule.inactive_location',
  inactive_item: 'adjustments.rule.inactive_item',
  secondary_quantity_not_allowed: 'adjustments.rule.secondary_quantity_not_allowed',
  expired_lot: 'adjustments.rule.expired_lot',
  negative_stock_plant: 'adjustments.rule.negative_stock',
  negative_stock_warehouse: 'adjustments.rule.negative_stock',
  negative_stock_in_transit: 'adjustments.rule.negative_stock',
};

/** What is wrong with one line (backend `adjustment-rules.ts`). */
const LINE_PROBLEMS: Record<string, MessageKey> = {
  QUANTITY_NOT_A_NUMBER: 'adjustments.line.quantityNumber',
  QUANTITY_ZERO: 'adjustments.line.quantityZero',
  QUANTITY_TOO_PRECISE: 'adjustments.line.quantityPrecise',
  QUANTITY_TOO_LARGE: 'adjustments.line.tooLarge',
  SECONDARY_QUANTITY_NOT_ALLOWED: 'adjustments.line.piecesNotAllowed',
  SECONDARY_QUANTITY_INVALID: 'adjustments.line.piecesInvalid',
  SECONDARY_QUANTITY_SIGN: 'adjustments.line.piecesInvalid',
  REASON_MISSING: 'adjustments.line.reasonMissing',
  REASON_TOO_LONG: 'adjustments.line.reasonTooLong',
};

const LOT_ERRORS: Record<string, MessageKey> = {
  UNKNOWN_LOT: 'adjustments.line.lot',
  LOT_NOT_AT_LOCATION: 'adjustments.line.lotElsewhere',
  DUPLICATE_LOT: 'adjustments.line.lotTwice',
  ITEM_INACTIVE: 'adjustments.line.itemInactive',
};

const LOCATION_PROBLEMS: Record<string, MessageKey> = {
  LOCATION_SYSTEM_MANAGED: 'adjustments.error.locationInTransit',
  LOCATION_INACTIVE: 'adjustments.error.locationInactive',
};

/** A refusal's message, from its rule and details, wherever it came from. */
function ruleMessage(
  rule: unknown,
  details: Record<string, unknown> | undefined,
): { key: MessageKey; params: MessageParams } | undefined {
  const key = RULES[String(rule)];
  if (!key) return undefined;
  return {
    key,
    params: {
      lineNo: Number(details?.lineNo ?? 0),
      lot: String(details?.lotNumber ?? ''),
      location: String(details?.locationCode ?? ''),
    },
  };
}

function describeError(error: ApiError): { key: MessageKey; params?: MessageParams } | undefined {
  const details = error.details as Record<string, unknown> | undefined;
  const lineNo = Number(details?.lineNo ?? 0);
  switch (error.code) {
    case 'POSTING_REFUSED':
      return ruleMessage(details?.rule, details);
    case 'INVALID_STOCK_ADJUSTMENT_LINE': {
      const key = LINE_PROBLEMS[String(details?.problem)];
      return key ? { key, params: { lineNo } } : undefined;
    }
    case 'UNKNOWN_LOT':
    case 'LOT_NOT_AT_LOCATION':
    case 'DUPLICATE_LOT':
    case 'ITEM_INACTIVE':
      return {
        key: LOT_ERRORS[error.code],
        params: { lineNo, lot: String(details?.lotNumber ?? '') },
      };
    case 'LOCATION_NOT_ALLOWED': {
      const key = LOCATION_PROBLEMS[String(details?.problem)];
      return key ? { key } : undefined;
    }
    default:
      return undefined;
  }
}

const STATUS: Record<AdjustmentHeader['status'], { key: MessageKey; tone: string }> = {
  draft: { key: 'adjustments.status.draft', tone: 'badge--neutral' },
  submitted: { key: 'adjustments.status.submitted', tone: 'badge--neutral' },
  approved: { key: 'adjustments.status.approved', tone: 'badge--down' },
  posted: { key: 'adjustments.status.posted', tone: 'badge--up' },
  rejected: { key: 'adjustments.status.rejected', tone: 'badge--down' },
};

function StatusBadge({ status }: { status: AdjustmentHeader['status'] }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS[status].tone}`}>{t(STATUS[status].key)}</span>;
}

/**
 * Stock adjustments (#8): an increase or a decrease on lots already at a location, each line
 * with its reason — a write-off of damaged stock, or the difference a count found. A plant or
 * branch user drafts and submits it; someone else approves it (ADR-0008), which posts it at
 * once. Everyone signed in reads them.
 */
export function StockAdjustmentsPage() {
  const { t, language } = useI18n();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canRaise = permissions.includes(Permission.STOCK_ADJUSTMENT_RAISE);
  const canApprove = permissions.includes(Permission.STOCK_ADJUSTMENT_APPROVE);
  const documents = useQuery({ queryKey: qk.stockAdjustments, queryFn: listAdjustments });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <section className="page page--wide" aria-labelledby="adjustments-title">
      <div className="page__header">
        <div>
          <h1 id="adjustments-title">{t('adjustments.title')}</h1>
          <p className="muted">{t('adjustments.intro')}</p>
        </div>
        {canRaise && !creating && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setOpenId(null);
              setNotice(null);
            }}
          >
            {t('adjustments.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p
          className={`callout ${notice.tone === 'success' ? 'callout--success' : 'callout--danger'}`}
          role="status"
        >
          {t(notice.key, notice.params)}
          {notice.detail && <> {t(notice.detail.key, notice.detail.params)}</>}
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
        <AdjustmentPanel
          key={openId}
          id={openId}
          canRaise={canRaise}
          canApprove={canApprove}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      {documents.isPending && (
        <p className="muted" role="status">
          {t('adjustments.loading')}
        </p>
      )}
      {documents.isError && <ErrorCallout error={documents.error} />}

      {documents.data && (
        <>
          <p className="subtle" role="status">
            {t('adjustments.count', { count: documents.data.length })}
          </p>
          {documents.data.length === 0 ? (
            <p className="muted">{t('adjustments.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('adjustments.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('adjustments.column.number')}</th>
                    <th scope="col">{t('adjustments.column.location')}</th>
                    <th scope="col">{t('adjustments.column.businessDate')}</th>
                    <th scope="col" className="numeric">
                      {t('adjustments.column.lines')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('adjustments.column.value')}
                    </th>
                    <th scope="col">{t('adjustments.column.status')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('adjustments.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {documents.data.map((doc) => (
                    <tr key={doc.id} className={doc.status === 'rejected' ? 'row--off' : undefined}>
                      <th scope="row">
                        <code>{doc.number}</code>
                      </th>
                      <td data-label={t('adjustments.column.location')}>
                        <span>
                          <span className="cell-title">{nameOf(doc.location)}</span>
                          <span className="subtle">
                            <code>{doc.location.code}</code>
                          </span>
                        </span>
                      </td>
                      <td className="nowrap" data-label={t('adjustments.column.businessDate')}>
                        <span>{formatBusinessDate(doc.businessDate, language)}</span>
                      </td>
                      <td className="numeric" data-label={t('adjustments.column.lines')}>
                        <span>{doc.lineCount}</span>
                      </td>
                      <td className="numeric nowrap" data-label={t('adjustments.column.value')}>
                        <span>{groupDigits(doc.totalValue)}</span>
                      </td>
                      <td data-label={t('adjustments.column.status')}>
                        <StatusBadge status={doc.status} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('adjustments.open.label', { number: doc.number })}
                          aria-expanded={openId === doc.id}
                          onClick={() => {
                            setOpenId(openId === doc.id ? null : doc.id);
                            setCreating(false);
                            setNotice(null);
                          }}
                        >
                          {t('adjustments.open.short')}
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

/** One adjustment: its draft form for whoever may raise, or the document and its next step. */
function AdjustmentPanel({
  id,
  canRaise,
  canApprove,
  onClose,
  onNotice,
}: {
  id: string;
  canRaise: boolean;
  canApprove: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t } = useI18n();
  const doc = useQuery({ queryKey: qk.stockAdjustment(id), queryFn: () => getAdjustment(id) });

  if (doc.isPending) {
    return (
      <p className="muted" role="status">
        {t('adjustments.loadingOne')}
      </p>
    );
  }
  if (doc.isError) return <ErrorCallout error={doc.error} />;
  if (doc.data.status === 'draft' && canRaise) {
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
    <AdjustmentDocument
      key={doc.data.revision}
      doc={doc.data}
      canApprove={canApprove}
      onClose={onClose}
      onNotice={onNotice}
    />
  );
}

interface LineState {
  key: number;
  lotId: string;
  direction: 'out' | 'in';
  quantity: string;
  secondaryQuantity: string;
  reason: string;
}

/** A lot the person can pick: held here today (with its quantity), or already on the draft. */
interface LotChoice {
  lot: { id: string; number: string };
  item: { id: string; nameTh: string; nameEn: string; baseUnitCode: string };
  quantity: string | null;
}

let nextLineKey = 1;
const blankLine = (): LineState => ({
  key: nextLineKey++,
  lotId: '',
  direction: 'out',
  quantity: '',
  secondaryQuantity: '',
  reason: '',
});
const unsigned = (text: string) => text.trim().replace(/^[-+]/, '');
const signed = (direction: LineState['direction'], text: string) => {
  const value = unsigned(text);
  return value && direction === 'out' ? `-${value}` : value;
};

/** A new draft, or a saved one to edit and submit. */
function DraftForm({
  doc,
  onClose,
  onSaved,
}: {
  doc?: AdjustmentView;
  onClose: () => void;
  onSaved: (doc: AdjustmentView, notice: Notice) => void;
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
          lotId: line.lot.id,
          direction: line.quantity.startsWith('-') ? 'out' : 'in',
          quantity: unsigned(line.quantity),
          secondaryQuantity: unsigned(line.secondaryQuantity ?? ''),
          reason: line.reason,
        }))
      : [blankLine()],
  );
  const [confirming, setConfirming] = useState(false);
  const held = useQuery({
    queryKey: qk.stockOnHand({ locationId }),
    queryFn: () => stockOnHand({ locationId }),
    enabled: Boolean(locationId),
  });

  useEffect(() => headingRef.current?.focus(), []);

  const itemById = new Map((items.data ?? []).map((item) => [item.id, item]));
  const stockable = (locations.data ?? []).filter(
    (l) => l.active && (l.type === 'plant' || l.type === 'warehouse' || l.type === 'branch'),
  );
  // The lots at this location today, and any the draft already names (they may be at zero).
  const lots = new Map<string, LotChoice>(
    (doc?.lines ?? [])
      .filter(() => doc?.location.id === locationId)
      .map((line) => [line.lot.id, { lot: line.lot, item: line.item, quantity: null }]),
  );
  for (const row of held.data?.rows ?? []) {
    lots.set(row.lot.id, { lot: row.lot, item: row.item, quantity: row.quantity });
  }
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const setLine = (key: number, change: Partial<LineState>) =>
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.stockAdjustments });
  };

  const input = () => ({
    locationId,
    ...(businessDate ? { businessDate } : {}),
    note: note.trim(),
    lines: lines
      .filter((line) => line.lotId || line.quantity || line.reason)
      .map((line) => {
        const itemId = lots.get(line.lotId)?.item.id ?? '';
        const weighed = itemById.get(itemId)?.variableWeight ?? false;
        return {
          lotId: line.lotId,
          quantity: signed(line.direction, line.quantity),
          secondaryQuantity:
            weighed && unsigned(line.secondaryQuantity)
              ? signed(line.direction, line.secondaryQuantity)
              : null,
          reason: line.reason.trim(),
        };
      }),
  });

  const save = useMutation({
    mutationFn: () =>
      doc ? updateAdjustment(doc.id, doc.revision, input()) : createAdjustment(input()),
    onSuccess: async (saved) => {
      await refresh();
      onSaved(saved, {
        key: doc ? 'adjustments.saved' : 'adjustments.created',
        params: { number: saved.number },
        tone: 'success',
      });
    },
  });

  const submit = useMutation({
    mutationFn: () => submitAdjustment(doc!.id, doc!.revision),
    onSuccess: async (sent) => {
      await refresh();
      onSaved(sent, {
        key: 'adjustments.submitted',
        params: { number: sent.number },
        tone: 'success',
      });
    },
    onSettled: () => setConfirming(false),
  });

  const busy = save.isPending || submit.isPending;
  const titleId = doc ? 'adjustment-draft-title' : 'adjustment-new-title';

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.reset();
    save.mutate();
  };

  return (
    <form className="panel" onSubmit={onSubmit} aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {doc ? t('adjustments.draft.title', { number: doc.number }) : t('adjustments.create.title')}
      </h2>
      <p className="subtle">{t('adjustments.draft.hint')}</p>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="ad-location">{t('adjustments.field.location')}</label>
          <select
            id="ad-location"
            required
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setLines((all) => all.map((line) => ({ ...line, lotId: '' })));
            }}
          >
            <option value="">{t('adjustments.field.chooseLocation')}</option>
            {stockable.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {nameOf(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ad-business-date">{t('adjustments.field.businessDate')}</label>
          <input
            id="ad-business-date"
            type="date"
            aria-describedby="ad-business-date-hint"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
          />
          <p id="ad-business-date-hint" className="subtle">
            {t('adjustments.field.businessDateHint')}
          </p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="ad-note">{t('adjustments.field.note')}</label>
        <textarea
          id="ad-note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <fieldset className="document-lines">
        <legend>{t('adjustments.lines.legend')}</legend>
        <p className="subtle">{t('adjustments.lines.intro')}</p>
        {lines.map((line, index) => {
          const n = index + 1;
          const chosen = lots.get(line.lotId);
          const item = chosen ? itemById.get(chosen.item.id) : undefined;
          const base = chosen ? unitName(units.data ?? [], chosen.item.baseUnitCode, language) : '';
          return (
            <div key={line.key} className="document-line">
              <div className="field">
                <label htmlFor={`ad-lot-${line.key}`}>
                  {t('adjustments.line.lotLabel', { n })}
                </label>
                <select
                  id={`ad-lot-${line.key}`}
                  value={line.lotId}
                  disabled={!locationId}
                  onChange={(e) =>
                    setLine(line.key, { lotId: e.target.value, secondaryQuantity: '' })
                  }
                >
                  <option value="">{t('adjustments.line.chooseLot')}</option>
                  {[...lots.values()].map(({ lot, item: lotItem, quantity }) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.number} · {nameOf(lotItem)}
                      {quantity !== null
                        ? ` · ${groupDigits(quantity)} ${unitName(units.data ?? [], lotItem.baseUnitCode, language)}`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`ad-direction-${line.key}`}>
                  {t('adjustments.line.directionLabel', { n })}
                </label>
                <select
                  id={`ad-direction-${line.key}`}
                  value={line.direction}
                  onChange={(e) =>
                    setLine(line.key, { direction: e.target.value as LineState['direction'] })
                  }
                >
                  <option value="out">{t('adjustments.line.out')}</option>
                  <option value="in">{t('adjustments.line.in')}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`ad-quantity-${line.key}`}>
                  {base
                    ? t('adjustments.line.quantityIn', { n, unit: base })
                    : t('adjustments.line.quantityLabel', { n })}
                </label>
                <input
                  id={`ad-quantity-${line.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.quantity}
                  onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                />
              </div>
              {item?.variableWeight && (
                <div className="field">
                  <label htmlFor={`ad-pieces-${line.key}`}>
                    {t('adjustments.line.piecesLabel', { n })}
                  </label>
                  <input
                    id={`ad-pieces-${line.key}`}
                    inputMode="numeric"
                    autoComplete="off"
                    value={line.secondaryQuantity}
                    onChange={(e) => setLine(line.key, { secondaryQuantity: e.target.value })}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor={`ad-reason-${line.key}`}>
                  {t('adjustments.line.reasonLabel', { n })}
                </label>
                <input
                  id={`ad-reason-${line.key}`}
                  maxLength={200}
                  autoComplete="off"
                  value={line.reason}
                  onChange={(e) => setLine(line.key, { reason: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="button button--ghost button--small"
                aria-label={t('adjustments.line.removeLabel', { n })}
                onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
              >
                {t('adjustments.line.remove')}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setLines((all) => [...all, blankLine()])}
        >
          {t('adjustments.line.add')}
        </button>
      </fieldset>

      {save.isError && (
        <ErrorCallout error={save.error} messages={ERRORS} describe={describeError} />
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {save.isPending ? t('adjustments.saving') : t('adjustments.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t(doc ? 'adjustments.close' : 'adjustments.cancel')}
        </button>
      </div>

      {doc && (
        <div className="panel__footer">
          {confirming ? (
            <div className="callout" role="group" aria-labelledby="submit-confirm-text">
              <p id="submit-confirm-text">
                {t('adjustments.submit.confirm', {
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
                  onClick={() => submit.mutate()}
                >
                  {submit.isPending ? t('adjustments.submit.sending') : t('adjustments.submit.yes')}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setConfirming(false)}
                >
                  {t('adjustments.notYet')}
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
              {t('adjustments.submit.open')}
            </button>
          )}
          <p className="subtle">{t('adjustments.submit.hint')}</p>
          {submit.isError && (
            <ErrorCallout error={submit.error} messages={ERRORS} describe={describeError} />
          )}
        </div>
      )}
    </form>
  );
}

/** A submitted, approved, posted or rejected adjustment, and the approver's next step. */
function AdjustmentDocument({
  doc,
  canApprove,
  onClose,
  onNotice,
}: {
  doc: AdjustmentView;
  canApprove: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const me = useAuthStore((s) => s.user?.id);
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const [rejectReason, setRejectReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const ownDocument = doc.createdBy.id === me;

  useEffect(() => headingRef.current?.focus(), []);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.stockAdjustments });
    await queryClient.invalidateQueries({ queryKey: qk.stockOnHandAll });
  };

  /** Approving or posting: posted, or approved with the ledger's reason for not posting. */
  const outcome = (result: AdjustmentView | ApprovedView): Notice => {
    const refusal = 'postingRefusal' in result ? result.postingRefusal : null;
    if (result.status === 'posted') {
      return { key: 'adjustments.posted', params: { number: result.number }, tone: 'success' };
    }
    return {
      key: 'adjustments.approvedNotPosted',
      params: { number: result.number },
      tone: 'warning',
      detail: refusal ? ruleMessage(refusal.rule, refusal.details) : undefined,
    };
  };

  const approve = useMutation({
    mutationFn: () => approveAdjustment(doc.id, doc.revision),
    onSuccess: async (result) => {
      await refresh();
      onNotice(outcome(result));
    },
    onSettled: () => setConfirming(false),
  });
  const post = useMutation({
    mutationFn: () => postAdjustment(doc.id, doc.revision),
    onSuccess: async (result) => {
      await refresh();
      onNotice(outcome(result));
    },
  });
  const reject = useMutation({
    mutationFn: () => rejectAdjustment(doc.id, doc.revision, rejectReason.trim()),
    onSuccess: async (result) => {
      await refresh();
      onNotice({
        key: 'adjustments.rejectedNotice',
        params: { number: result.number },
        tone: 'success',
      });
    },
  });
  const busy = approve.isPending || post.isPending || reject.isPending;
  const decidable = doc.status === 'submitted' || doc.status === 'approved';

  return (
    <section className="panel" aria-labelledby="adjustment-view-title">
      <h2 id="adjustment-view-title" ref={headingRef} tabIndex={-1}>
        {t('adjustments.view.title', { number: doc.number })} <StatusBadge status={doc.status} />
      </h2>
      <dl className="facts">
        <div>
          <dt>{t('adjustments.column.location')}</dt>
          <dd>
            {nameOf(doc.location)} <code>{doc.location.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t('adjustments.column.businessDate')}</dt>
          <dd>{formatBusinessDate(doc.businessDate, language)}</dd>
        </div>
        <div>
          <dt>{t('adjustments.view.raised')}</dt>
          <dd>
            {t('adjustments.view.by', {
              name: doc.createdBy.displayName,
              time: formatDateTime(doc.createdAt, language),
            })}
          </dd>
        </div>
        {doc.submitted && (
          <div>
            <dt>{t('adjustments.view.submitted')}</dt>
            <dd>
              {t('adjustments.view.by', {
                name: doc.submitted.by.displayName,
                time: formatDateTime(doc.submitted.at, language),
              })}
            </dd>
          </div>
        )}
        {doc.approved && (
          <div>
            <dt>{t('adjustments.view.approved')}</dt>
            <dd>
              {t('adjustments.view.by', {
                name: doc.approved.by.displayName,
                time: formatDateTime(doc.approved.at, language),
              })}
            </dd>
          </div>
        )}
        {doc.postedAt && doc.postedBy && (
          <div>
            <dt>{t('adjustments.view.posted')}</dt>
            <dd>
              {t('adjustments.view.by', {
                name: doc.postedBy.displayName,
                time: formatDateTime(doc.postedAt, language),
              })}
            </dd>
          </div>
        )}
        {doc.rejected && (
          <div>
            <dt>{t('adjustments.view.rejected')}</dt>
            <dd>
              {t('adjustments.view.by', {
                name: doc.rejected.by.displayName,
                time: formatDateTime(doc.rejected.at, language),
              })}
              <span className="subtle"> · {doc.rejected.reason}</span>
            </dd>
          </div>
        )}
        {doc.note && (
          <div>
            <dt>{t('adjustments.field.note')}</dt>
            <dd>{doc.note}</dd>
          </div>
        )}
      </dl>

      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">
            {t('adjustments.view.caption', { number: doc.number })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('adjustments.column.item')}</th>
              <th scope="col">{t('adjustments.column.lot')}</th>
              <th scope="col" className="numeric">
                {t('stock.column.quantity')}
              </th>
              <th scope="col" className="numeric">
                {t('stock.column.pieces')}
              </th>
              <th scope="col" className="numeric">
                {t('stock.column.value')}
              </th>
              <th scope="col">{t('adjustments.column.reason')}</th>
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
                <td data-label={t('adjustments.column.lot')}>
                  <span>
                    <code>{line.lot.number}</code>
                    <span className="subtle">
                      {t('stock.expires', {
                        date: formatBusinessDate(line.lot.expiryDate, language),
                      })}
                    </span>
                  </span>
                </td>
                <td className="numeric nowrap" data-label={t('stock.column.quantity')}>
                  <span>
                    {groupDigits(line.quantity)}{' '}
                    {unitName(units.data ?? [], line.item.baseUnitCode, language)}
                  </span>
                </td>
                <td className="numeric nowrap" data-label={t('stock.column.pieces')}>
                  <span>
                    {line.secondaryQuantity === null
                      ? t('stock.noPieces')
                      : t('stock.pieces', { count: groupDigits(line.secondaryQuantity) })}
                  </span>
                </td>
                <td className="numeric nowrap" data-label={t('stock.column.value')}>
                  <span>{groupDigits(line.value)}</span>
                </td>
                <td data-label={t('adjustments.column.reason')}>
                  <span>{line.reason}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>
                {t('stock.total')}
              </th>
              <td className="numeric nowrap">
                <strong>{groupDigits(doc.totalValue)}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {doc.status === 'approved' && (
        <p className="callout">{t('adjustments.view.approvedNotPosted')}</p>
      )}

      {canApprove && decidable && (
        <div className="panel__footer">
          <h3>{t('adjustments.decide.title')}</h3>
          {doc.status === 'submitted' &&
            (ownDocument ? (
              <p className="callout">{t('adjustments.approve.own')}</p>
            ) : confirming ? (
              <div className="callout" role="group" aria-labelledby="approve-confirm-text">
                <p id="approve-confirm-text">
                  {t('adjustments.approve.confirm', {
                    number: doc.number,
                    value: groupDigits(doc.totalValue),
                  })}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => approve.mutate()}
                  >
                    {approve.isPending
                      ? t('adjustments.approve.approving')
                      : t('adjustments.approve.yes')}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setConfirming(false)}
                  >
                    {t('adjustments.notYet')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  approve.reset();
                  setConfirming(true);
                }}
              >
                {t('adjustments.approve.open')}
              </button>
            ))}
          {doc.status === 'approved' && (
            <button type="button" className="button" disabled={busy} onClick={() => post.mutate()}>
              {post.isPending ? t('adjustments.post.posting') : t('adjustments.post.open')}
            </button>
          )}
          {approve.isError && (
            <ErrorCallout error={approve.error} messages={ERRORS} describe={describeError} />
          )}
          {post.isError && (
            <ErrorCallout error={post.error} messages={ERRORS} describe={describeError} />
          )}

          <div className="field">
            <label htmlFor="reject-reason">{t('adjustments.reject.reason')}</label>
            <input
              id="reject-reason"
              maxLength={500}
              aria-describedby="reject-reason-hint"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <p id="reject-reason-hint" className="subtle">
              {t('adjustments.reject.hint')}
            </p>
          </div>
          <button
            type="button"
            className="button button--ghost"
            disabled={busy || !rejectReason.trim()}
            onClick={() => reject.mutate()}
          >
            {reject.isPending ? t('adjustments.reject.rejecting') : t('adjustments.reject.open')}
          </button>
          {reject.isError && (
            <ErrorCallout error={reject.error} messages={ERRORS} describe={describeError} />
          )}
        </div>
      )}
      <div className="actions">
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('adjustments.close')}
        </button>
      </div>
    </section>
  );
}

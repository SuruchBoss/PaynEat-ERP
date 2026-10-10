// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listItems, listUnits, unitName } from '@/features/items/items.api';
import { listLocations } from '@/features/locations/locations.api';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import type { ApiError } from '@/lib/api-error';
import { compare, subtract } from '@/lib/decimal';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  cancelTransfer,
  reverseTransfer,
  createReceipt,
  createTransfer,
  dispatchTransfer,
  getReceipt,
  getTransfer,
  listTransfers,
  rejectReceipt,
  stepReceipt,
  updateReceipt,
  type Check,
  type DispatchPickInput,
  type Finding,
  type ReceiptLineInput,
  type ReceiptStatus,
  type TransferLine,
  type TransferReceiptView,
  type TransferStatus,
  type TransferStatusFilter,
  type TransferView,
} from './transfers.api';

/** Kept as keys, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const ERRORS: Record<string, MessageKey> = {
  DOCUMENT_CHANGED: 'tr.error.changed',
  STEP_NOT_ALLOWED: 'tr.error.step',
  INVALID_ROUTE: 'tr.error.route',
  CANCELLATION_REASON_MISSING: 'tr.error.reason',
  REJECTION_REASON_MISSING: 'tr.error.reason',
  TRANSFER_NOT_RECEIVABLE: 'tr.error.notReceivable',
  RECEIPT_LINES_MISSING: 'tr.error.linesMissing',
  BUSINESS_DATE_IN_FUTURE: 'tr.rule.business_date_in_future',
  INVALID_DATE: 'tr.error.invalid',
  VALIDATION_FAILED: 'tr.error.invalid',
};

/** Why a dispatch or a receipt cannot post, by the ledger's rule names (backend `posting-rules.ts`). */
const RULES: Record<string, MessageKey> = {
  empty_document: 'tr.rule.empty_document',
  inactive_location: 'tr.rule.inactive_location',
  inactive_item: 'tr.rule.inactive_item',
  nothing_picked: 'tr.rule.nothing_picked',
  expired_lot: 'tr.rule.expired_lot',
  pieces_required: 'tr.rule.pieces_required',
  negative_stock_plant: 'tr.rule.negative_stock',
  negative_stock_warehouse: 'tr.rule.negative_stock',
  negative_stock_in_transit: 'tr.rule.negative_stock',
  cancelled: 'tr.error.step',
  transfer_not_dispatched: 'tr.rule.transfer_not_dispatched',
  already_received: 'tr.rule.already_received',
  transfer_reversed: 'tr.rule.transfer_reversed',
  already_reversed: 'tr.error.step',
  business_date_before_dispatch: 'tr.rule.business_date_before_dispatch',
  temperature_required: 'tr.rule.temperature_required',
  difference_unresolved: 'tr.rule.difference_unresolved',
  reason_required: 'tr.rule.reason_required',
  expired_on_arrival: 'tr.rule.expired_on_arrival',
  needs_approval: 'tr.rule.needs_approval',
  self_approval: 'tr.rule.self_approval',
  business_date_in_future: 'tr.rule.business_date_in_future',
  stale_revision: 'tr.error.changed',
  already_posted: 'tr.error.step',
  not_approved: 'tr.error.step',
};

function describeError(error: ApiError): { key: MessageKey; params?: MessageParams } | undefined {
  const details = error.details as Record<string, unknown> | undefined;
  if (error.code === 'POSTING_REFUSED') {
    const key = RULES[String(details?.rule)];
    return key
      ? {
          key,
          params: {
            lineNo: Number(details?.lineNo ?? 0),
            lot: String(details?.lotNumber ?? ''),
          },
        }
      : undefined;
  }
  if (
    error.code === 'INVALID_TRANSFER_LINE' ||
    error.code === 'INVALID_TRANSFER_PICK' ||
    error.code === 'INVALID_RECEIPT_LINE'
  ) {
    return { key: 'tr.error.line', params: { problem: error.message } };
  }
  return undefined;
}

const STATUS: Record<TransferStatus, { key: MessageKey; tone: string }> = {
  draft: { key: 'tr.status.draft', tone: 'badge--neutral' },
  dispatched: { key: 'tr.status.dispatched', tone: 'badge--neutral' },
  received: { key: 'tr.status.received', tone: 'badge--up' },
  reversed: { key: 'tr.status.reversed', tone: 'badge--down' },
  cancelled: { key: 'tr.status.cancelled', tone: 'badge--down' },
};

const RECEIPT_STATUS: Record<ReceiptStatus, { key: MessageKey; tone: string }> = {
  draft: { key: 'tr.receipt.status.draft', tone: 'badge--neutral' },
  submitted: { key: 'tr.receipt.status.submitted', tone: 'badge--neutral' },
  approved: { key: 'tr.receipt.status.approved', tone: 'badge--neutral' },
  posted: { key: 'tr.receipt.status.posted', tone: 'badge--up' },
  rejected: { key: 'tr.receipt.status.rejected', tone: 'badge--down' },
};

const FILTERS: TransferStatusFilter[] = [
  'all',
  'draft',
  'dispatched',
  'received',
  'reversed',
  'cancelled',
];

const nonZero = (value: string | null) => value !== null && /[1-9]/.test(value);

function StatusBadge({ status }: { status: TransferStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS[status].tone}`}>{t(STATUS[status].key)}</span>;
}

function ReceiptBadge({ status }: { status: ReceiptStatus }) {
  const { t } = useI18n();
  return (
    <span className={`badge ${RECEIPT_STATUS[status].tone}`}>{t(RECEIPT_STATUS[status].key)}</span>
  );
}

/**
 * Transfers (#14): logistics drafts what a branch needs from the plant, confirms the lots that
 * really left (FEFO suggests them, never an expired lot), and the stock waits in transit. The
 * branch manager records what arrived on a phone at the back door, lot by lot; whatever did not
 * arrive in good condition goes back to the plant or is written off, with a reason, and the plant
 * approves findings and write-offs. Finance reads them.
 */
export function TransfersPage() {
  const { t, language } = useI18n();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canDispatch = permissions.includes(Permission.TRANSFER_DISPATCH);
  const [status, setStatus] = useState<TransferStatusFilter>('all');
  const transfers = useQuery({
    queryKey: qk.transferList(status),
    queryFn: () => listTransfers(status),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <section className="page page--wide" aria-labelledby="tr-title">
      <div className="page__header">
        <div>
          <h1 id="tr-title">{t('tr.title')}</h1>
          <p className="muted">{t('tr.intro')}</p>
        </div>
        {canDispatch && !creating && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setOpenId(null);
              setNotice(null);
            }}
          >
            {t('tr.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}
        </p>
      )}

      {creating && (
        <CreateForm
          onClose={() => setCreating(false)}
          onCreated={(transfer) => {
            setCreating(false);
            setOpenId(transfer.id);
            setNotice({ key: 'tr.created', params: { number: transfer.number } });
          }}
        />
      )}
      {openId && (
        <TransferPanel
          key={openId}
          id={openId}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      <div className="field field--inline">
        <label htmlFor="tr-status-filter">{t('tr.filter.label')}</label>
        <select
          id="tr-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as TransferStatusFilter)}
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'all' ? t('tr.filter.all') : t(STATUS[f].key)}
            </option>
          ))}
        </select>
      </div>

      {transfers.isPending && (
        <p className="muted" role="status">
          {t('tr.loading')}
        </p>
      )}
      {transfers.isError && <ErrorCallout error={transfers.error} />}

      {transfers.data && (
        <>
          <p className="subtle" role="status">
            {t('tr.count', { count: transfers.data.length })}
          </p>
          {transfers.data.length === 0 ? (
            <p className="muted">{t('tr.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('tr.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('tr.column.number')}</th>
                    <th scope="col">{t('tr.column.route')}</th>
                    <th scope="col">{t('tr.column.date')}</th>
                    <th scope="col" className="numeric">
                      {t('tr.column.lines')}
                    </th>
                    <th scope="col">{t('tr.column.status')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('tr.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.data.map((transfer) => (
                    <tr
                      key={transfer.id}
                      className={transfer.status === 'cancelled' ? 'row--off' : undefined}
                    >
                      <th scope="row">
                        <code>{transfer.number}</code>
                      </th>
                      <td data-label={t('tr.column.route')}>
                        <span>
                          {t('tr.route', {
                            origin: nameOf(transfer.origin),
                            destination: nameOf(transfer.destination),
                          })}
                        </span>
                      </td>
                      <td className="nowrap" data-label={t('tr.column.date')}>
                        <span>{formatBusinessDate(transfer.businessDate, language)}</span>
                      </td>
                      <td className="numeric" data-label={t('tr.column.lines')}>
                        <span>{transfer.lineCount}</span>
                      </td>
                      <td data-label={t('tr.column.status')}>
                        <StatusBadge status={transfer.status} />
                        {transfer.receivedBy && (
                          <span className="subtle">
                            {' '}
                            <code>{transfer.receivedBy.receipt.number}</code>
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('tr.open.label', { number: transfer.number })}
                          aria-expanded={openId === transfer.id}
                          onClick={() => {
                            setOpenId(openId === transfer.id ? null : transfer.id);
                            setCreating(false);
                            setNotice(null);
                          }}
                        >
                          {t('tr.open.short')}
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

/** A new draft: from where, to where, and what. */
function CreateForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (transfer: TransferView) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [businessDate, setBusinessDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ itemId: '', quantity: '' }]);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const active = (locations.data ?? []).filter((l) => l.active);
  const origins = active.filter((l) => l.type === 'plant' || l.type === 'warehouse');
  const destinations = active.filter(
    (l) => (l.type === 'branch' || l.type === 'warehouse') && l.id !== originId,
  );
  const stocked = (items.data ?? []).filter((i) => i.active);

  const create = useMutation({
    mutationFn: () =>
      createTransfer({
        originId,
        destinationId,
        ...(businessDate ? { businessDate } : {}),
        note: note.trim(),
        lines: lines
          .filter((l) => l.itemId && l.quantity.trim())
          .map((l) => ({ itemId: l.itemId, quantity: l.quantity.trim() })),
      }),
    onSuccess: async (transfer) => {
      await queryClient.invalidateQueries({ queryKey: qk.transfers });
      onCreated(transfer);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  const setLine = (index: number, field: 'itemId' | 'quantity', value: string) =>
    setLines((all) => all.map((l, i) => (i === index ? { ...l, [field]: value } : l)));

  return (
    <form className="panel" aria-labelledby="tr-create-title" onSubmit={submit}>
      <h2 id="tr-create-title">{t('tr.create.title')}</h2>
      <p className="subtle">{t('tr.create.hint')}</p>
      <div className="field">
        <label htmlFor="tr-origin">{t('tr.field.origin')}</label>
        <select
          id="tr-origin"
          required
          value={originId}
          onChange={(e) => setOriginId(e.target.value)}
        >
          <option value="">{t('tr.field.choose')}</option>
          {origins.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} · {nameOf(l)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="tr-destination">{t('tr.field.destination')}</label>
        <select
          id="tr-destination"
          required
          value={destinationId}
          onChange={(e) => setDestinationId(e.target.value)}
        >
          <option value="">{t('tr.field.choose')}</option>
          {destinations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} · {nameOf(l)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="tr-date">{t('tr.field.date')}</label>
        <DateField
          id="tr-date"
          describedBy="tr-date-hint"
          value={businessDate}
          onChange={setBusinessDate}
        />
        <p id="tr-date-hint" className="subtle">
          {t('tr.field.dateHint')}
        </p>
      </div>
      <fieldset className="fieldset">
        <legend>{t('tr.field.lines')}</legend>
        {lines.map((line, index) => (
          <div className="field-row" key={index}>
            <div className="field">
              <label htmlFor={`tr-line-item-${index}`}>
                {t('tr.field.item', { lineNo: index + 1 })}
              </label>
              <select
                id={`tr-line-item-${index}`}
                value={line.itemId}
                onChange={(e) => setLine(index, 'itemId', e.target.value)}
              >
                <option value="">{t('tr.field.choose')}</option>
                {stocked.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {nameOf(item)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`tr-line-quantity-${index}`}>
                {t('tr.field.quantity', { lineNo: index + 1 })}
              </label>
              <input
                id={`tr-line-quantity-${index}`}
                className="input--narrow"
                inputMode="decimal"
                value={line.quantity}
                onChange={(e) => setLine(index, 'quantity', e.target.value)}
              />
            </div>
            {lines.length > 1 && (
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setLines((all) => all.filter((_, i) => i !== index))}
              >
                {t('tr.field.removeLine', { lineNo: index + 1 })}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setLines((all) => [...all, { itemId: '', quantity: '' }])}
        >
          {t('tr.field.addLine')}
        </button>
      </fieldset>
      <div className="field">
        <label htmlFor="tr-note">{t('tr.field.note')}</label>
        <input
          id="tr-note"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {create.isError && (
        <ErrorCallout error={create.error} messages={ERRORS} describe={describeError} />
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={create.isPending}>
          {t('tr.create.submit')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('tr.close')}
        </button>
      </div>
    </form>
  );
}

function TransferPanel({
  id,
  onClose,
  onNotice,
}: {
  id: string;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t } = useI18n();
  const transfer = useQuery({ queryKey: qk.transfer(id), queryFn: () => getTransfer(id) });
  if (transfer.isPending) {
    return (
      <p className="muted" role="status">
        {t('tr.loadingOne')}
      </p>
    );
  }
  if (transfer.isError) return <ErrorCallout error={transfer.error} />;
  return (
    <TransferDocument
      key={transfer.data.revision}
      transfer={transfer.data}
      onClose={onClose}
      onNotice={onNotice}
    />
  );
}

/** What logistics is typing for one lot of one line. */
type PickState = Record<string, { quantity: string; pieces: string }>;

function initialPicks(transfer: TransferView): Record<number, PickState> {
  return Object.fromEntries(
    transfer.lines.map((line) => [
      line.lineNo,
      Object.fromEntries(
        line.picks.map((p) => [p.lotId, { quantity: p.quantity, pieces: p.pieces ?? '' }]),
      ),
    ]),
  );
}

function TransferDocument({
  transfer,
  onClose,
  onNotice,
}: {
  transfer: TransferView;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canDispatch = permissions.includes(Permission.TRANSFER_DISPATCH);
  const canReceive = permissions.includes(Permission.TRANSFER_RECEIVE);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const editable = canDispatch && transfer.status === 'draft';
  const [picks, setPicks] = useState(() => initialPicks(transfer));
  const [reason, setReason] = useState('');
  const [reversalNote, setReversalNote] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const unit = (code: string) => unitName(units.data ?? [], code, language);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.transfers });
    await queryClient.invalidateQueries({ queryKey: qk.stockOnHandAll });
  };

  const dispatch = useMutation({
    mutationFn: () => dispatchTransfer(transfer.id, transfer.revision, picksOf(transfer, picks)),
    onSuccess: async (result) => {
      await refresh();
      onNotice({ key: 'tr.dispatched', params: { number: result.number } });
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelTransfer(transfer.id, transfer.revision, reason.trim()),
    onSuccess: async (result) => {
      await refresh();
      onNotice({ key: 'tr.cancelledNotice', params: { number: result.number } });
    },
  });
  const reverse = useMutation({
    mutationFn: () => reverseTransfer(transfer.id, reversalNote.trim()),
    onSuccess: async (result) => {
      await refresh();
      onNotice({ key: 'tr.reversedNotice', params: { number: result.number } });
    },
  });
  const busy = dispatch.isPending || cancel.isPending || reverse.isPending;
  // Logistics takes back a dispatch that should not have left, until a receipt of it posts.
  const reversible = canDispatch && transfer.status === 'dispatched';
  const by = (record: { by: { displayName: string }; at: string }) =>
    t('tr.view.by', { name: record.by.displayName, time: formatDateTime(record.at, language) });
  const openReceipt = transfer.receipts.find(
    (r) => r.status === 'draft' || r.status === 'submitted' || r.status === 'approved',
  );

  return (
    <section className="panel" aria-labelledby={`tr-view-title-${transfer.id}`}>
      <h2 id={`tr-view-title-${transfer.id}`} ref={headingRef} tabIndex={-1}>
        {t('tr.view.title', { number: transfer.number })} <StatusBadge status={transfer.status} />
      </h2>
      <dl className="facts">
        <div>
          <dt>{t('tr.field.origin')}</dt>
          <dd>
            {nameOf(transfer.origin)} <code>{transfer.origin.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t('tr.field.destination')}</dt>
          <dd>
            {nameOf(transfer.destination)} <code>{transfer.destination.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t('tr.column.date')}</dt>
          <dd>{formatBusinessDate(transfer.businessDate, language)}</dd>
        </div>
        <div>
          <dt>{t('tr.view.created')}</dt>
          <dd>{by({ by: transfer.createdBy, at: transfer.createdAt })}</dd>
        </div>
        {transfer.dispatched && (
          <div>
            <dt>{t('tr.view.dispatched')}</dt>
            <dd>{by(transfer.dispatched)}</dd>
          </div>
        )}
        {transfer.received && (
          <div>
            <dt>{t('tr.view.received')}</dt>
            <dd>
              {by({ by: transfer.received.by, at: transfer.received.at })}{' '}
              <code>{transfer.received.receipt.number}</code>
              {transfer.received.approvedBy && (
                <span className="subtle">
                  {' '}
                  · {t('tr.view.approvedBy', { name: transfer.received.approvedBy.displayName })}
                </span>
              )}
            </dd>
          </div>
        )}
        {transfer.reversed && (
          <div>
            <dt>{t('tr.view.reversed')}</dt>
            <dd>
              {by(transfer.reversed)} <code>{transfer.reversed.reversal.number}</code>
              {transfer.reversed.note && (
                <span className="subtle"> · {transfer.reversed.note}</span>
              )}
            </dd>
          </div>
        )}
        {transfer.cancelled && (
          <div>
            <dt>{t('tr.view.cancelled')}</dt>
            <dd>
              {by(transfer.cancelled)}
              <span className="subtle"> · {transfer.cancelled.reason}</span>
            </dd>
          </div>
        )}
        {transfer.status === 'dispatched' && transfer.inTransit && (
          <div>
            <dt>{t('tr.view.inTransit')}</dt>
            <dd>
              <code>{transfer.inTransit.code}</code>
            </dd>
          </div>
        )}
        {transfer.note && (
          <div>
            <dt>{t('tr.field.note')}</dt>
            <dd>{transfer.note}</dd>
          </div>
        )}
      </dl>

      <h3>{t('tr.lines.title')}</h3>
      {transfer.status === 'draft' && <p className="subtle">{t('tr.lines.suggested')}</p>}
      {transfer.lines.map((line) => (
        <LineSection
          key={line.lineNo}
          line={line}
          state={picks[line.lineNo] ?? {}}
          editable={editable}
          received={transfer.status === 'received'}
          unit={unit(line.item.baseUnitCode)}
          onPick={(lotId, field, value) =>
            setPicks((all) => {
              const mine = all[line.lineNo] ?? {};
              const pick = mine[lotId] ?? { quantity: '', pieces: '' };
              return { ...all, [line.lineNo]: { ...mine, [lotId]: { ...pick, [field]: value } } };
            })
          }
        />
      ))}

      {transfer.status === 'draft' && (
        <Blockers blockers={transfer.blockers} lines={transfer.lines} />
      )}

      {transfer.receipts.length > 0 && (
        <>
          <h3>{t('tr.receipts.title')}</h3>
          <ul className="plain-list">
            {transfer.receipts.map((receipt) => (
              <li key={receipt.id}>
                <code>{receipt.number}</code> <ReceiptBadge status={receipt.status} />{' '}
                <span className="subtle">{receipt.createdBy.displayName}</span>{' '}
                <button
                  type="button"
                  className="button button--ghost button--small"
                  aria-label={t('tr.receipt.open.label', { number: receipt.number })}
                  aria-expanded={receiptId === receipt.id}
                  onClick={() => {
                    setReceiptId(receiptId === receipt.id ? null : receipt.id);
                    setReceiving(false);
                  }}
                >
                  {t('tr.open.short')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {receiptId && (
        <ReceiptPanel
          key={receiptId}
          id={receiptId}
          transfer={transfer}
          onNotice={onNotice}
          onDone={() => setReceiptId(null)}
        />
      )}
      {receiving && (
        <ReceiptForm
          transfer={transfer}
          receipt={null}
          onClose={() => setReceiving(false)}
          onSaved={(receipt) => {
            setReceiving(false);
            setReceiptId(receipt.id);
          }}
        />
      )}

      <div className="panel__footer">
        {editable && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => dispatch.mutate()}
          >
            {t('tr.dispatch.open')}
          </button>
        )}
        {dispatch.isError && (
          <ErrorCallout error={dispatch.error} messages={ERRORS} describe={describeError} />
        )}
        {canReceive && transfer.status === 'dispatched' && !receiving && !openReceipt && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setReceiving(true);
              setReceiptId(null);
            }}
          >
            {t('tr.receive.open')}
          </button>
        )}
        {editable && (
          <>
            <div className="field">
              <label htmlFor={`tr-cancel-reason-${transfer.id}`}>{t('tr.cancel.label')}</label>
              <input
                id={`tr-cancel-reason-${transfer.id}`}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={busy || !reason.trim()}
                onClick={() => cancel.mutate()}
              >
                {t('tr.cancel.open')}
              </button>
            </div>
          </>
        )}
        {cancel.isError && (
          <ErrorCallout error={cancel.error} messages={ERRORS} describe={describeError} />
        )}
        {reversible && (
          <>
            <p className="subtle">{t('tr.reverse.hint')}</p>
            <div className="field">
              <label htmlFor={`tr-reverse-note-${transfer.id}`}>{t('tr.reverse.label')}</label>
              <input
                id={`tr-reverse-note-${transfer.id}`}
                maxLength={500}
                value={reversalNote}
                onChange={(e) => setReversalNote(e.target.value)}
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => reverse.mutate()}
              >
                {t('tr.reverse.open')}
              </button>
            </div>
          </>
        )}
        {reverse.isError && (
          <ErrorCallout error={reverse.error} messages={ERRORS} describe={describeError} />
        )}
      </div>
      <div className="actions">
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('tr.close')}
        </button>
      </div>
    </section>
  );
}

/** The lots one line takes: suggested and every choice while a draft, then what left and how it ended. */
function LineSection({
  line,
  state,
  editable,
  received,
  unit,
  onPick,
}: {
  line: TransferLine;
  state: PickState;
  editable: boolean;
  received: boolean;
  unit: string;
  onPick: (lotId: string, field: 'quantity' | 'pieces', value: string) => void;
}) {
  const { t, language } = useI18n();
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const rows = editable
    ? line.availableLots
    : line.picks.map((p) => ({
        lotId: p.lotId,
        number: p.number,
        expiryDate: p.expiryDate,
        expired: false,
        unitCost: p.unitCost,
        available: null as string | null,
        availablePieces: null as string | null,
      }));
  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption>
          <span className="cell-title">{nameOf(line.item)}</span> <code>{line.item.code}</code>{' '}
          <span className="subtle">
            {t('tr.lines.asked', { quantity: groupDigits(line.quantity), unit })}
            {' · '}
            {t('tr.lines.dispatched', { quantity: groupDigits(line.dispatched), unit })}
            {nonZero(line.shortBy) && (
              <> · {t('tr.lines.short', { quantity: groupDigits(line.shortBy!), unit })}</>
            )}
            {received && (
              <>
                {' · '}
                {t('tr.lines.outcome', {
                  accepted: groupDigits(line.accepted ?? '0'),
                  returned: groupDigits(line.returned ?? '0'),
                  writtenOff: groupDigits(line.writtenOff ?? '0'),
                  unit,
                })}
              </>
            )}
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('tr.column.lot')}</th>
            <th scope="col">{t('tr.column.expiry')}</th>
            {editable && (
              <th scope="col" className="numeric">
                {t('tr.column.available')}
              </th>
            )}
            <th scope="col" className="numeric">
              {t('tr.column.take')}
            </th>
            {line.item.variableWeight && <th scope="col">{t('tr.column.pieces')}</th>}
            {received && <th scope="col">{t('tr.column.outcome')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6}>{t('tr.lines.none')}</td>
            </tr>
          )}
          {rows.map((lot) => {
            const pick = line.picks.find((p) => p.lotId === lot.lotId);
            const typed = state[lot.lotId];
            return (
              <tr key={lot.lotId} className={lot.expired ? 'row--off' : undefined}>
                <th scope="row">
                  <code>{lot.number}</code>
                  {lot.expired && (
                    <span className="badge badge--down badge--inline">{t('tr.lot.expired')}</span>
                  )}
                </th>
                <td className="nowrap" data-label={t('tr.column.expiry')}>
                  {formatBusinessDate(lot.expiryDate, language)}
                </td>
                {editable && (
                  <td className="numeric nowrap" data-label={t('tr.column.available')}>
                    {groupDigits(lot.available ?? '0')} {unit}
                    {lot.availablePieces && (
                      <span className="subtle">
                        {t('tr.pieces', { pieces: groupDigits(lot.availablePieces) })}
                      </span>
                    )}
                  </td>
                )}
                <td className="numeric nowrap" data-label={t('tr.column.take')}>
                  {editable && !lot.expired ? (
                    <input
                      className="input--narrow"
                      inputMode="decimal"
                      aria-label={t('tr.take.label', { lot: lot.number })}
                      value={typed?.quantity ?? ''}
                      onChange={(e) => onPick(lot.lotId, 'quantity', e.target.value)}
                    />
                  ) : pick ? (
                    `${groupDigits(pick.quantity)} ${unit}`
                  ) : (
                    '—'
                  )}
                </td>
                {line.item.variableWeight && (
                  <td className="nowrap" data-label={t('tr.column.pieces')}>
                    {editable && !lot.expired ? (
                      <input
                        className="input--narrow"
                        inputMode="numeric"
                        aria-label={t('tr.pieces.label', { lot: lot.number })}
                        value={typed?.pieces ?? ''}
                        onChange={(e) => onPick(lot.lotId, 'pieces', e.target.value)}
                      />
                    ) : (
                      (pick?.pieces ?? '—')
                    )}
                  </td>
                )}
                {received && (
                  <td data-label={t('tr.column.outcome')}>
                    {pick?.outcome ? (
                      <span>
                        {t('tr.lines.outcome', {
                          accepted: groupDigits(pick.outcome.accepted),
                          returned: groupDigits(pick.outcome.returned),
                          writtenOff: groupDigits(pick.outcome.writtenOff),
                          unit,
                        })}
                        {pick.outcome.reason && (
                          <span className="subtle"> · {pick.outcome.reason}</span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What would refuse the dispatch or the receipt now, in words. */
function Blockers({
  blockers,
  lines,
}: {
  blockers: Check[];
  lines: Array<{ lineNo: number; item: { nameTh: string; nameEn: string } }>;
}) {
  const { t, language } = useI18n();
  if (blockers.length === 0) {
    return <p className="callout callout--success">{t('tr.blockers.none')}</p>;
  }
  const lineName = (lineNo?: number) => {
    const line = lines.find((l) => l.lineNo === lineNo);
    return line ? (language === 'th' ? line.item.nameTh : line.item.nameEn) : '';
  };
  return (
    <div className="callout" role="status">
      <p>{t('tr.blockers.title')}</p>
      <ul className="plain-list">
        {blockers.map((blocker) => (
          <li key={`${blocker.rule}-${blocker.lineNo}-${blocker.lotId ?? ''}`}>
            {t(RULES[blocker.rule] ?? 'tr.error.step', { lineNo: blocker.lineNo ?? 0, lot: '' })}
            {blocker.lineNo !== undefined && (
              <span className="subtle"> · {lineName(blocker.lineNo)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReceiptPanel({
  id,
  transfer,
  onNotice,
  onDone,
}: {
  id: string;
  transfer: TransferView;
  onNotice: (notice: Notice) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const receipt = useQuery({ queryKey: qk.transferReceipt(id), queryFn: () => getReceipt(id) });
  if (receipt.isPending) {
    return (
      <p className="muted" role="status">
        {t('tr.loadingOne')}
      </p>
    );
  }
  if (receipt.isError) return <ErrorCallout error={receipt.error} />;
  return (
    <ReceiptDocument
      key={receipt.data.revision}
      receipt={receipt.data}
      transfer={transfer}
      onNotice={onNotice}
      onDone={onDone}
    />
  );
}

function ReceiptDocument({
  receipt,
  transfer,
  onNotice,
  onDone,
}: {
  receipt: TransferReceiptView;
  transfer: TransferView;
  onNotice: (notice: Notice) => void;
  onDone: () => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const userId = useAuthStore((s) => s.user?.id);
  const canReceive = permissions.includes(Permission.TRANSFER_RECEIVE);
  const canApprove = permissions.includes(Permission.TRANSFER_APPROVE_RECEIPT);
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const [editing, setEditing] = useState(false);
  const [rejection, setRejection] = useState('');
  const unit = (code: string) => unitName(units.data ?? [], code, language);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.transfers });
    await queryClient.invalidateQueries({ queryKey: qk.stockOnHandAll });
  };
  const step = useMutation({
    mutationFn: (name: 'submit' | 'approve' | 'post') =>
      stepReceipt(receipt.id, name, receipt.revision),
    onSuccess: async (result) => {
      await refresh();
      onNotice({
        key: result.status === 'posted' ? 'tr.receipt.posted' : 'tr.receipt.submittedNotice',
        params: { number: result.number, transfer: transfer.number },
      });
    },
  });
  const reject = useMutation({
    mutationFn: () => rejectReceipt(receipt.id, receipt.revision, rejection.trim()),
    onSuccess: async (result) => {
      await refresh();
      onNotice({ key: 'tr.receipt.rejectedNotice', params: { number: result.number } });
      onDone();
    },
  });
  const busy = step.isPending || reject.isPending;
  const own = receipt.createdBy.id === userId;

  if (editing) {
    return (
      <ReceiptForm
        transfer={transfer}
        receipt={receipt}
        onClose={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return (
    <section className="panel panel--nested" aria-labelledby={`tr-receipt-${receipt.id}`}>
      <h3 id={`tr-receipt-${receipt.id}`}>
        {t('tr.receipt.title', { number: receipt.number })} <ReceiptBadge status={receipt.status} />
      </h3>
      <p className="subtle">
        {t('tr.view.by', {
          name: receipt.createdBy.displayName,
          time: formatDateTime(receipt.createdAt, language),
        })}
        {receipt.approved && (
          <> · {t('tr.view.approvedBy', { name: receipt.approved.by.displayName })}</>
        )}
        {receipt.rejected && (
          <>
            {' · '}
            {t('tr.receipt.rejectedBy', {
              name: receipt.rejected.by.displayName,
              reason: receipt.rejected.reason,
            })}
          </>
        )}
      </p>
      <ul className="receipt-cards">
        {receipt.lines.map((line) => {
          const u = unit(line.item.baseUnitCode);
          return (
            <li key={line.lineNo} className="receipt-card">
              <p className="cell-title">
                {nameOf(line.item)} <code>{line.lot.number}</code>
              </p>
              <p className="subtle">
                {t('tr.receipt.dispatched', { quantity: groupDigits(line.dispatched), unit: u })}
                {' · '}
                {t('tr.receipt.received', { quantity: groupDigits(line.received), unit: u })}
                {line.temperature !== null && (
                  <> · {t('tr.receipt.temperature', { temperature: line.temperature })}</>
                )}
              </p>
              <p>
                {t('tr.lines.outcome', {
                  accepted: groupDigits(line.accepted),
                  returned: groupDigits(line.returned),
                  writtenOff: groupDigits(line.writtenOff),
                  unit: u,
                })}
              </p>
              {line.findings.length > 0 && (
                <p className="badge badge--down badge--inline">
                  {line.findings.map((f) => findingText(f, t)).join(' · ')}
                </p>
              )}
              {line.reason && <p className="subtle">{line.reason}</p>}
              {nonZero(line.unresolved) && (
                <p className="subtle">
                  {t('tr.receipt.unresolved', { quantity: line.unresolved, unit: u })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {receipt.status !== 'posted' && receipt.status !== 'rejected' && (
        <>
          <Blockers
            blockers={receipt.blockers}
            lines={receipt.lines.map((l) => ({ lineNo: l.lineNo, item: l.item }))}
          />
          {receipt.needsApproval && <p className="subtle">{t('tr.receipt.needsApproval')}</p>}
        </>
      )}
      {receipt.postingRefusal && (
        <p className="callout callout--danger" role="alert">
          {t(RULES[receipt.postingRefusal.rule] ?? 'tr.error.step', { lineNo: 0, lot: '' })}
        </p>
      )}
      <div className="actions">
        {canReceive && receipt.status === 'draft' && (
          <>
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              {t('tr.receipt.edit')}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || receipt.blockers.length > 0}
              onClick={() => step.mutate('submit')}
            >
              {receipt.needsApproval ? t('tr.receipt.submitForApproval') : t('tr.receipt.submit')}
            </button>
          </>
        )}
        {canApprove && receipt.status === 'submitted' && !own && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => step.mutate('approve')}
          >
            {t('tr.receipt.approve')}
          </button>
        )}
        {canApprove && receipt.status === 'approved' && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => step.mutate('post')}
          >
            {t('tr.receipt.retry')}
          </button>
        )}
      </div>
      {canApprove && (receipt.status === 'submitted' || receipt.status === 'approved') && !own && (
        <>
          <div className="field">
            <label htmlFor={`tr-reject-${receipt.id}`}>{t('tr.receipt.rejectLabel')}</label>
            <input
              id={`tr-reject-${receipt.id}`}
              maxLength={500}
              value={rejection}
              onChange={(e) => setRejection(e.target.value)}
            />
          </div>
          <div className="actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={busy || !rejection.trim()}
              onClick={() => reject.mutate()}
            >
              {t('tr.receipt.reject')}
            </button>
          </div>
        </>
      )}
      {canApprove && receipt.status === 'submitted' && own && (
        <p className="subtle">{t('tr.receipt.notYourOwn')}</p>
      )}
      {step.isError && (
        <ErrorCallout error={step.error} messages={ERRORS} describe={describeError} />
      )}
      {reject.isError && (
        <ErrorCallout error={reject.error} messages={ERRORS} describe={describeError} />
      )}
    </section>
  );
}

/** What the branch is typing for one lot line at the back door. */
interface ArrivalState {
  received: string;
  receivedPieces: string;
  temperature: string;
  condition: string;
  accepted: string;
  acceptedPieces: string;
  returned: string;
  returnedPieces: string;
  reason: string;
}

interface LotLine {
  lineNo: number;
  item: {
    nameTh: string;
    nameEn: string;
    code: string;
    baseUnitCode: string;
    variableWeight: boolean;
  };
  lot: string;
  dispatched: string;
  dispatchedPieces: string | null;
}

function lotLinesOf(transfer: TransferView): LotLine[] {
  return transfer.lines.flatMap((line) =>
    line.picks.map((pick) => ({
      lineNo: pick.pickNo!,
      item: line.item,
      lot: pick.number,
      dispatched: pick.quantity,
      dispatchedPieces: pick.pieces,
    })),
  );
}

/**
 * Recording what arrived, made for a phone at the back door: one card per lot that left, what
 * arrived prefilled with what was sent, and whatever is neither accepted nor sent back is written
 * off, worked out as the person types, so nothing is left in transit.
 */
function ReceiptForm({
  transfer,
  receipt,
  onClose,
  onSaved,
}: {
  transfer: TransferView;
  receipt: TransferReceiptView | null;
  onClose: () => void;
  onSaved: (receipt: TransferReceiptView) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const lines = lotLinesOf(transfer);
  const [state, setState] = useState<Record<number, ArrivalState>>(() =>
    Object.fromEntries(
      lines.map((line) => {
        const stored = receipt?.lines.find((l) => l.lineNo === line.lineNo);
        return [
          line.lineNo,
          stored
            ? {
                received: stored.received,
                receivedPieces: stored.receivedPieces ?? '',
                temperature: stored.temperature ?? '',
                condition: stored.condition,
                accepted: stored.accepted,
                acceptedPieces: stored.acceptedPieces ?? '',
                returned: stored.returned,
                returnedPieces: stored.returnedPieces ?? '',
                reason: stored.reason ?? '',
              }
            : {
                received: line.dispatched,
                receivedPieces: line.dispatchedPieces ?? '',
                temperature: '',
                condition: 'good',
                accepted: line.dispatched,
                acceptedPieces: line.dispatchedPieces ?? '',
                returned: '0',
                returnedPieces: line.dispatchedPieces === null ? '' : '0',
                reason: '',
              },
        ];
      }),
    ),
  );
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const unit = (code: string) => unitName(units.data ?? [], code, language);

  const set = (lineNo: number, field: keyof ArrivalState, value: string) =>
    setState((all) => {
      const before = all[lineNo];
      const next = { ...before, [field]: value };
      // Typing what arrived moves what is accepted along with it, until the person changes it.
      if (field === 'received' && before.accepted === before.received) {
        const line = lines.find((l) => l.lineNo === lineNo)!;
        next.accepted = compare(value, line.dispatched) === 1 ? line.dispatched : value;
      }
      if (field === 'receivedPieces' && before.acceptedPieces === before.receivedPieces) {
        next.acceptedPieces = value;
      }
      return { ...all, [lineNo]: next };
    });

  const save = useMutation({
    mutationFn: () => {
      const input = arrivalsOf(lines, state);
      return receipt
        ? updateReceipt(receipt.id, receipt.revision, input)
        : createReceipt(transfer.id, input);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: qk.transfers });
      onSaved(saved);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form
      className="panel panel--nested receipt-form"
      onSubmit={submit}
      aria-labelledby="tr-receive-title"
    >
      <h3 id="tr-receive-title">
        {t('tr.receive.title', {
          number: transfer.number,
          destination: nameOf(transfer.destination),
        })}
      </h3>
      <p className="subtle">{t('tr.receive.hint')}</p>
      {lines.map((line) => {
        const s = state[line.lineNo];
        const u = unit(line.item.baseUnitCode);
        const writtenOff = subtract(line.dispatched, s.accepted, s.returned);
        const writtenOffPieces =
          line.dispatchedPieces === null
            ? null
            : subtract(line.dispatchedPieces, s.acceptedPieces, s.returnedPieces);
        const id = (field: string) => `tr-arrival-${line.lineNo}-${field}`;
        const label = (key: MessageKey) => `${t(key)} · ${line.lot}`;
        return (
          <fieldset key={line.lineNo} className="receipt-card">
            <legend>
              {nameOf(line.item)} <code>{line.lot}</code>
            </legend>
            <p className="subtle">
              {t('tr.receipt.dispatched', { quantity: groupDigits(line.dispatched), unit: u })}
              {line.dispatchedPieces !== null && (
                <> {t('tr.pieces', { pieces: line.dispatchedPieces })}</>
              )}
            </p>
            <div className="receipt-card__grid">
              <div className="field">
                <label htmlFor={id('received')}>{label('tr.field.received')}</label>
                <input
                  id={id('received')}
                  inputMode="decimal"
                  value={s.received}
                  onChange={(e) => set(line.lineNo, 'received', e.target.value)}
                />
              </div>
              {line.item.variableWeight && (
                <div className="field">
                  <label htmlFor={id('received-pieces')}>{label('tr.field.receivedPieces')}</label>
                  <input
                    id={id('received-pieces')}
                    inputMode="numeric"
                    value={s.receivedPieces}
                    onChange={(e) => set(line.lineNo, 'receivedPieces', e.target.value)}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor={id('temperature')}>{label('tr.field.temperature')}</label>
                <input
                  id={id('temperature')}
                  inputMode="decimal"
                  value={s.temperature}
                  onChange={(e) => set(line.lineNo, 'temperature', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={id('condition')}>{label('tr.field.condition')}</label>
                <select
                  id={id('condition')}
                  value={s.condition}
                  onChange={(e) => set(line.lineNo, 'condition', e.target.value)}
                >
                  <option value="good">{t('tr.condition.good')}</option>
                  <option value="damaged">{t('tr.condition.damaged')}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={id('accepted')}>{label('tr.field.accepted')}</label>
                <input
                  id={id('accepted')}
                  inputMode="decimal"
                  value={s.accepted}
                  onChange={(e) => set(line.lineNo, 'accepted', e.target.value)}
                />
              </div>
              {line.item.variableWeight && (
                <div className="field">
                  <label htmlFor={id('accepted-pieces')}>{label('tr.field.acceptedPieces')}</label>
                  <input
                    id={id('accepted-pieces')}
                    inputMode="numeric"
                    value={s.acceptedPieces}
                    onChange={(e) => set(line.lineNo, 'acceptedPieces', e.target.value)}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor={id('returned')}>{label('tr.field.returned')}</label>
                <input
                  id={id('returned')}
                  inputMode="decimal"
                  value={s.returned}
                  onChange={(e) => set(line.lineNo, 'returned', e.target.value)}
                />
              </div>
              {line.item.variableWeight && (
                <div className="field">
                  <label htmlFor={id('returned-pieces')}>{label('tr.field.returnedPieces')}</label>
                  <input
                    id={id('returned-pieces')}
                    inputMode="numeric"
                    value={s.returnedPieces}
                    onChange={(e) => set(line.lineNo, 'returnedPieces', e.target.value)}
                  />
                </div>
              )}
            </div>
            <p
              className={
                writtenOff !== null && writtenOff.startsWith('-')
                  ? 'callout callout--danger'
                  : 'subtle'
              }
              aria-live="polite"
            >
              {writtenOff === null
                ? t('tr.receive.writtenOffUnknown')
                : writtenOff.startsWith('-')
                  ? t('tr.receive.tooMuch', { quantity: writtenOff.slice(1), unit: u })
                  : t('tr.receive.writtenOff', {
                      quantity: groupDigits(writtenOff),
                      unit: u,
                    })}
              {writtenOffPieces !== null && writtenOffPieces !== '0' && (
                <> {t('tr.pieces', { pieces: writtenOffPieces })}</>
              )}
            </p>
            <div className="field">
              <label htmlFor={id('reason')}>{label('tr.field.reason')}</label>
              <input
                id={id('reason')}
                maxLength={500}
                aria-describedby={id('reason-hint')}
                value={s.reason}
                onChange={(e) => set(line.lineNo, 'reason', e.target.value)}
              />
              <p id={id('reason-hint')} className="subtle">
                {t('tr.field.reasonHint')}
              </p>
            </div>
          </fieldset>
        );
      })}
      {save.isError && (
        <ErrorCallout error={save.error} messages={ERRORS} describe={describeError} />
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {t('tr.receive.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('tr.close')}
        </button>
      </div>
    </form>
  );
}

function findingText(
  finding: Finding,
  t: (key: MessageKey, params?: MessageParams) => string,
): string {
  switch (finding.code) {
    case 'too_warm':
      return t('tr.finding.too_warm', { temperature: finding.temperature, limit: finding.limit });
    case 'over_quantity':
    case 'under_quantity':
      return t(`tr.finding.${finding.code}`, {
        variance: finding.variancePercent ?? '',
        limit: finding.limitPercent,
      });
    case 'damaged':
      return t('tr.finding.damaged');
    default:
      return t('tr.finding.other');
  }
}

/** The lots that left, as the API takes them; empty boxes and zeros are left out. */
function picksOf(transfer: TransferView, picks: Record<number, PickState>): DispatchPickInput[] {
  return transfer.lines.flatMap((line) =>
    Object.entries(picks[line.lineNo] ?? {})
      .filter(([, pick]) => pick.quantity.trim() !== '' && compare(pick.quantity, '0') !== 0)
      .map(([lotId, pick]) => ({
        lineNo: line.lineNo,
        lotId,
        quantity: pick.quantity.trim(),
        pieces: pick.pieces.trim() === '' ? null : pick.pieces.trim(),
      })),
  );
}

/** Every lot line as the API takes it: what is neither accepted nor returned is written off. */
function arrivalsOf(lines: LotLine[], state: Record<number, ArrivalState>): ReceiptLineInput[] {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  return lines.map((line) => {
    const s = state[line.lineNo];
    const pieces = line.item.variableWeight;
    return {
      lineNo: line.lineNo,
      received: s.received.trim(),
      receivedPieces: pieces ? text(s.receivedPieces) : null,
      temperature: text(s.temperature),
      condition: s.condition,
      accepted: s.accepted.trim(),
      acceptedPieces: pieces ? text(s.acceptedPieces) : null,
      returned: s.returned.trim() || '0',
      returnedPieces: pieces ? (text(s.returnedPieces) ?? '0') : null,
      writtenOff: subtract(line.dispatched, s.accepted, s.returned) ?? '0',
      writtenOffPieces: pieces
        ? (subtract(line.dispatchedPieces ?? '0', s.acceptedPieces, s.returnedPieces) ?? '0')
        : null,
      reason: text(s.reason),
    };
  });
}

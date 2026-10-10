// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listItems, listUnits, unitName } from '@/features/items/items.api';
import { listLocations } from '@/features/locations/locations.api';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import type { ApiError } from '@/lib/api-error';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  cancelRequisition,
  createRequisition,
  createTransferFrom,
  getRequisition,
  getSuggestions,
  listRequisitions,
  submitRequisition,
  type RequisitionItemRef,
  type RequisitionStatus,
  type RequisitionStatusFilter,
} from './requisitions.api';

/** Kept as keys, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
  transferId?: string;
}

const REQUISITION_ERRORS: Record<string, MessageKey> = {
  REQUISITION_CHANGED: 'rq.error.changed',
  STEP_NOT_ALLOWED: 'rq.error.step',
  CANCELLATION_REASON_MISSING: 'rq.error.reason',
  EMPTY_REQUISITION: 'rq.error.empty',
  NEEDED_BY_PASSED: 'rq.error.neededByPassed',
  NOT_A_BRANCH: 'rq.error.notBranch',
  SUPPLYING_LOCATION_REQUIRED: 'rq.error.supplier',
  REQUISITION_HAS_DRAFT_TRANSFER: 'rq.error.draftTransfer',
  NOTHING_OUTSTANDING: 'rq.error.nothingOutstanding',
  INVALID_DATE: 'rq.error.invalid',
  VALIDATION_FAILED: 'rq.error.invalid',
};

function describeError(error: ApiError): { key: MessageKey; params?: MessageParams } | undefined {
  const details = error.details as Record<string, unknown> | undefined;
  if (error.code === 'INVALID_REQUISITION_LINE') {
    if (details?.problem === 'NOT_A_MULTIPLE') {
      return { key: 'rq.error.notMultiple', params: { unit: String(details.requisitionUnit) } };
    }
    return { key: 'rq.error.line', params: { problem: error.message } };
  }
  if (error.code === 'REQUISITION_HAS_DRAFT_TRANSFER') {
    return { key: 'rq.error.draftTransfer', params: { transfer: String(details?.transfer ?? '') } };
  }
  return undefined;
}

const STATUS: Record<RequisitionStatus, { key: MessageKey; tone: string }> = {
  draft: { key: 'rq.status.draft', tone: 'badge--neutral' },
  submitted: { key: 'rq.status.submitted', tone: 'badge--neutral' },
  partially_fulfilled: { key: 'rq.status.partially_fulfilled', tone: 'badge--neutral' },
  fulfilled: { key: 'rq.status.fulfilled', tone: 'badge--up' },
  cancelled: { key: 'rq.status.cancelled', tone: 'badge--down' },
};

/** A transfer's status, in the transfers screen's words (#14). */
const TRANSFER_STATUS: Record<string, MessageKey> = {
  draft: 'tr.status.draft',
  dispatched: 'tr.status.dispatched',
  received: 'tr.status.received',
  reversed: 'tr.status.reversed',
};

const FILTERS: RequisitionStatusFilter[] = [
  'all',
  'open',
  'draft',
  'submitted',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
];

function StatusBadge({ status }: { status: RequisitionStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS[status].tone}`}>{t(STATUS[status].key)}</span>;
}

/** Today on this device, as an ISO date: a starting value the person changes; the API checks it. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Branch requisitions (#15): the branch manager asks the plant for stock on a phone, from what the
 * screen suggests (par level less what the branch holds and what is on the road, in whole trays),
 * and submits it. Logistics works the queue of open requisitions by date needed and creates a
 * transfer from each (#14), prefilled with what is outstanding; a requisition is fulfilled by what
 * its transfers dispatched.
 */
export function RequisitionsPage() {
  const { t, language } = useI18n();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canRaise = permissions.includes(Permission.REQUISITION_RAISE);
  const canDispatch = permissions.includes(Permission.TRANSFER_DISPATCH);
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<RequisitionStatusFilter>(
    canDispatch && !canRaise ? 'open' : 'all',
  );
  const requisitions = useQuery({
    queryKey: qk.requisitionList(status),
    queryFn: () => listRequisitions(status),
  });
  const openId = params.get('open');
  const setOpenId = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true });
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <section className="page page--wide" aria-labelledby="rq-title">
      <div className="page__header">
        <div>
          <h1 id="rq-title">{t('rq.title')}</h1>
          <p className="muted">{t('rq.intro')}</p>
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
            {t('rq.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}{' '}
          {notice.transferId && <Link to="/transfers">{t('rq.transfer.goTo')}</Link>}
        </p>
      )}

      {creating && (
        <CreateForm
          onClose={() => setCreating(false)}
          onSaved={(requisition, submitted) => {
            setCreating(false);
            setOpenId(requisition.id);
            setNotice({
              key: submitted ? 'rq.submitted' : 'rq.created',
              params: { number: requisition.number },
            });
          }}
        />
      )}
      {openId && (
        <RequisitionPanel
          key={openId}
          id={openId}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      <div className="field field--inline">
        <label htmlFor="rq-status-filter">{t('rq.filter.label')}</label>
        <select
          id="rq-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as RequisitionStatusFilter)}
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'all'
                ? t('rq.filter.all')
                : f === 'open'
                  ? t('rq.filter.open')
                  : t(STATUS[f].key)}
            </option>
          ))}
        </select>
      </div>

      {requisitions.isPending && (
        <p className="muted" role="status">
          {t('rq.loading')}
        </p>
      )}
      {requisitions.isError && <ErrorCallout error={requisitions.error} />}

      {requisitions.data && (
        <>
          <p className="subtle" role="status">
            {t('rq.count', { count: requisitions.data.length })}
          </p>
          {requisitions.data.length === 0 ? (
            <p className="muted">{t('rq.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('rq.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('rq.column.number')}</th>
                    <th scope="col">{t('rq.column.branch')}</th>
                    <th scope="col">{t('rq.column.neededBy')}</th>
                    <th scope="col" className="numeric">
                      {t('rq.column.lines')}
                    </th>
                    <th scope="col">{t('rq.column.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {requisitions.data.map((r) => (
                    <tr key={r.id}>
                      <td data-label={t('rq.column.number')}>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('rq.open.label', { number: r.number })}
                          onClick={() => {
                            setCreating(false);
                            setNotice(null);
                            setOpenId(r.id);
                          }}
                        >
                          {r.number}
                        </button>
                      </td>
                      <td data-label={t('rq.column.branch')}>
                        {nameOf(r.branch)} <span className="subtle">({r.branch.code})</span>
                      </td>
                      <td data-label={t('rq.column.neededBy')}>
                        {formatBusinessDate(r.neededBy, language)}
                      </td>
                      <td data-label={t('rq.column.lines')} className="numeric">
                        {r.lineCount}
                      </td>
                      <td data-label={t('rq.column.status')}>
                        <StatusBadge status={r.status} />
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

interface DraftLine {
  item: RequisitionItemRef;
  /** What the screen suggests now; null without a par level. */
  suggested: string | null;
  par: string | null;
  balance: string | null;
  inTransit: string | null;
  requested: string;
}

/**
 * A new requisition, sized for a phone: the branch, the day it needs the stock, and a line per
 * item with a par level there, prefilled with the suggestion; other items can be added. Lines
 * left empty or at zero are not asked for.
 */
function CreateForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (requisition: { id: string; number: string }, submitted: boolean) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const branches = (locations.data ?? []).filter((l) => l.type === 'branch' && l.active);
  const plants = (locations.data ?? []).filter(
    (l) => (l.type === 'plant' || l.type === 'warehouse') && l.active,
  );
  const [branchId, setBranchId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [neededBy, setNeededBy] = useState(localToday());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [adding, setAdding] = useState('');
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const unitOf = (code: string) => unitName(units.data ?? [], code, language);

  const suggestions = useQuery({
    queryKey: qk.suggestions(branchId),
    queryFn: () => getSuggestions(branchId),
    enabled: branchId !== '',
  });
  // The suggestion fills the lines once per branch; after that they are the person's.
  const [filledFor, setFilledFor] = useState('');
  if (suggestions.data && filledFor !== branchId && suggestions.data.branch.id === branchId) {
    setFilledFor(branchId);
    setLines(
      suggestions.data.items.map((s) => ({
        item: s.item,
        suggested: s.suggested,
        par: s.par,
        balance: s.balance,
        inTransit: s.inTransit,
        requested: s.suggested && /[1-9]/.test(s.suggested) ? s.suggested : '',
      })),
    );
  }

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const created = await createRequisition({
        branchId,
        ...(supplierId ? { supplyingLocationId: supplierId } : {}),
        neededBy,
        note: note.trim() || null,
        lines: (lines ?? [])
          .filter((l) => /[1-9]/.test(l.requested))
          .map((l) => ({ itemId: l.item.id, requested: l.requested.trim() })),
      });
      return submit ? submitRequisition(created.id, created.revision) : created;
    },
    onSuccess: async (saved, submit) => {
      await queryClient.invalidateQueries({ queryKey: qk.requisitions });
      onSaved(saved, submit);
    },
  });
  // Which button submitted the form: set by its click, which runs before the submit event.
  const submitAfter = useRef(false);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(submitAfter.current);
  };

  const others = (items.data ?? []).filter(
    (i) => i.active && !(lines ?? []).some((l) => l.item.id === i.id),
  );

  return (
    <form className="panel" onSubmit={onSubmit} aria-labelledby="rq-create-title">
      <h2 id="rq-create-title">{t('rq.create.title')}</h2>
      <p className="subtle">{t('rq.create.hint')}</p>
      <div className="field">
        <label htmlFor="rq-branch">{t('rq.field.branch')}</label>
        <select
          id="rq-branch"
          required
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          <option value="">{t('rq.field.choose')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {nameOf(b)} ({b.code})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rq-supplier">{t('rq.field.supplier')}</label>
        <select id="rq-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">{t('rq.field.supplierDefault')}</option>
          {plants.map((p) => (
            <option key={p.id} value={p.id}>
              {nameOf(p)} ({p.code})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rq-needed-by">{t('rq.field.neededBy')}</label>
        <DateField id="rq-needed-by" value={neededBy} onChange={setNeededBy} required />
      </div>

      {suggestions.isError && <ErrorCallout error={suggestions.error} />}
      {branchId && lines && (
        <>
          {lines.length === 0 ? (
            <p className="muted">{t('rq.create.noPar')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption>{t('rq.create.linesCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('rq.column.item')}</th>
                    <th scope="col" className="numeric">
                      {t('rq.column.par')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('rq.column.balance')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('rq.column.inTransit')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('rq.column.suggested')}
                    </th>
                    <th scope="col">{t('rq.column.requested')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.item.id}>
                      <td data-label={t('rq.column.item')}>
                        {nameOf(line.item)} <span className="subtle">({line.item.code})</span>
                        {line.item.requisitionUnit && (
                          <span className="subtle">
                            {' · '}
                            {t('rq.unitHint', {
                              unit: line.item.requisitionUnit,
                              base: unitOf(line.item.baseUnitCode),
                            })}
                          </span>
                        )}
                      </td>
                      <td data-label={t('rq.column.par')} className="numeric">
                        {line.par === null ? t('rq.none') : groupDigits(line.par)}
                      </td>
                      <td data-label={t('rq.column.balance')} className="numeric">
                        {line.balance === null ? t('rq.none') : groupDigits(line.balance)}
                      </td>
                      <td data-label={t('rq.column.inTransit')} className="numeric">
                        {line.inTransit === null ? t('rq.none') : groupDigits(line.inTransit)}
                      </td>
                      <td data-label={t('rq.column.suggested')} className="numeric">
                        {line.suggested === null ? t('rq.none') : groupDigits(line.suggested)}
                      </td>
                      <td data-label={t('rq.column.requested')}>
                        <input
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={t('rq.requested.label', { item: nameOf(line.item) })}
                          value={line.requested}
                          onChange={(e) =>
                            setLines(
                              lines.map((l, i) =>
                                i === index ? { ...l, requested: e.target.value } : l,
                              ),
                            )
                          }
                        />{' '}
                        <span className="subtle">{unitOf(line.item.baseUnitCode)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="field field--inline">
            <label htmlFor="rq-add">{t('rq.add.label')}</label>
            <select id="rq-add" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">{t('rq.field.choose')}</option>
              {others.map((i) => (
                <option key={i.id} value={i.id}>
                  {nameOf(i)} ({i.code})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={adding === ''}
              onClick={() => {
                const item = others.find((i) => i.id === adding);
                if (!item) return;
                setLines([
                  ...lines,
                  {
                    item: {
                      id: item.id,
                      code: item.code,
                      nameTh: item.nameTh,
                      nameEn: item.nameEn,
                      baseUnitCode: item.baseUnitCode,
                      variableWeight: item.variableWeight,
                      requisitionUnit: item.requisitionUnit,
                    },
                    suggested: null,
                    par: null,
                    balance: null,
                    inTransit: null,
                    requested: '',
                  },
                ]);
                setAdding('');
              }}
            >
              {t('rq.add.button')}
            </button>
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="rq-note">{t('rq.field.note')}</label>
        <input
          id="rq-note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {save.isError && (
        <ErrorCallout error={save.error} messages={REQUISITION_ERRORS} describe={describeError} />
      )}
      <div className="actions">
        <button
          type="submit"
          className="button"
          disabled={save.isPending || !branchId}
          onClick={() => (submitAfter.current = true)}
        >
          {t('rq.create.submit')}
        </button>
        <button
          type="submit"
          className="button button--ghost"
          disabled={save.isPending || !branchId}
          onClick={() => (submitAfter.current = false)}
        >
          {t('rq.create.saveDraft')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('rq.create.close')}
        </button>
      </div>
    </form>
  );
}

/** One requisition: its lines against what its transfers dispatched, and the next steps. */
function RequisitionPanel({
  id,
  onClose,
  onNotice,
}: {
  id: string;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canRaise = permissions.includes(Permission.REQUISITION_RAISE);
  const canDispatch = permissions.includes(Permission.TRANSFER_DISPATCH);
  const requisition = useQuery({ queryKey: qk.requisition(id), queryFn: () => getRequisition(id) });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const [reason, setReason] = useState('');
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.requisitions });
    await queryClient.invalidateQueries({ queryKey: qk.transfers });
  };

  const step = useMutation({
    mutationFn: async (which: 'submit' | 'cancel' | 'transfer') => {
      const r = requisition.data!;
      if (which === 'submit') return { which, result: await submitRequisition(r.id, r.revision) };
      if (which === 'cancel') {
        return { which, result: await cancelRequisition(r.id, r.revision, reason.trim()) };
      }
      return { which, result: await createTransferFrom(r.id, r.revision) };
    },
    onSuccess: async ({ which, result }) => {
      await refresh();
      const number = requisition.data!.number;
      if (which === 'submit') onNotice({ key: 'rq.submitted', params: { number } });
      if (which === 'cancel') onNotice({ key: 'rq.cancelledNotice', params: { number } });
      if (which === 'transfer') {
        onNotice({
          key: 'rq.transfer.created',
          params: { number, transfer: result.number },
          transferId: result.id,
        });
      }
    },
  });

  if (requisition.isPending) {
    return (
      <p className="muted" role="status">
        {t('rq.loading')}
      </p>
    );
  }
  if (requisition.isError) return <ErrorCallout error={requisition.error} />;
  const r = requisition.data;
  const cancellable = r.status === 'draft' || r.status === 'submitted';
  const fulfillable = r.status === 'submitted' || r.status === 'partially_fulfilled';

  return (
    <article className="panel" aria-labelledby="rq-panel-title">
      <div className="page__header">
        <h2 id="rq-panel-title">
          {r.number} <StatusBadge status={r.status} />
        </h2>
        <button type="button" className="button button--ghost button--small" onClick={onClose}>
          {t('rq.panel.close')}
        </button>
      </div>
      <dl className="facts">
        <div>
          <dt>{t('rq.column.branch')}</dt>
          <dd>
            {nameOf(r.branch)} <code>{r.branch.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t('rq.field.supplier')}</dt>
          <dd>
            {nameOf(r.supplyingLocation)} <code>{r.supplyingLocation.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t('rq.column.neededBy')}</dt>
          <dd>{formatBusinessDate(r.neededBy, language)}</dd>
        </div>
        <div>
          <dt>{t('rq.panel.createdBy')}</dt>
          <dd>
            {r.createdBy.displayName} · {formatDateTime(r.createdAt, language)}
          </dd>
        </div>
        {r.submitted && (
          <div>
            <dt>{t('rq.panel.submittedBy')}</dt>
            <dd>
              {r.submitted.by.displayName} · {formatDateTime(r.submitted.at, language)}
            </dd>
          </div>
        )}
        {r.cancelled && (
          <div>
            <dt>{t('rq.panel.cancelledBy')}</dt>
            <dd>
              {r.cancelled.by.displayName} · {r.cancelled.reason}
            </dd>
          </div>
        )}
        {r.note && (
          <div>
            <dt>{t('rq.field.note')}</dt>
            <dd>{r.note}</dd>
          </div>
        )}
      </dl>

      <div className="table-scroll">
        <table className="data-table">
          <caption>{t('rq.panel.linesCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('rq.column.item')}</th>
              <th scope="col" className="numeric">
                {t('rq.column.suggested')}
              </th>
              <th scope="col" className="numeric">
                {t('rq.column.requested')}
              </th>
              <th scope="col" className="numeric">
                {t('rq.column.dispatched')}
              </th>
              <th scope="col" className="numeric">
                {t('rq.column.outstanding')}
              </th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((line) => {
              const unit = unitName(units.data ?? [], line.item.baseUnitCode, language);
              return (
                <tr key={line.lineNo}>
                  <td data-label={t('rq.column.item')}>
                    {nameOf(line.item)} <span className="subtle">({line.item.code})</span>
                  </td>
                  <td data-label={t('rq.column.suggested')} className="numeric">
                    {line.suggested === null ? t('rq.none') : groupDigits(line.suggested)}
                  </td>
                  <td data-label={t('rq.column.requested')} className="numeric">
                    {groupDigits(line.requested)} {unit}
                  </td>
                  <td data-label={t('rq.column.dispatched')} className="numeric">
                    {groupDigits(line.dispatched)}
                  </td>
                  <td data-label={t('rq.column.outstanding')} className="numeric">
                    {groupDigits(line.outstanding)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {r.transfers.length > 0 && (
        <>
          <h3>{t('rq.panel.transfers')}</h3>
          <ul className="plain-list">
            {r.transfers.map((tr) => (
              <li key={tr.id}>
                {tr.number} · {formatBusinessDate(tr.businessDate, language)} ·{' '}
                {t(TRANSFER_STATUS[tr.status] ?? 'tr.status.draft')}
              </li>
            ))}
          </ul>
        </>
      )}

      {step.isError && (
        <ErrorCallout error={step.error} messages={REQUISITION_ERRORS} describe={describeError} />
      )}
      <div className="actions">
        {canRaise && r.status === 'draft' && (
          <button
            type="button"
            className="button"
            disabled={step.isPending}
            onClick={() => step.mutate('submit')}
          >
            {t('rq.action.submit')}
          </button>
        )}
        {canDispatch && fulfillable && (
          <button
            type="button"
            className="button"
            disabled={step.isPending}
            onClick={() => step.mutate('transfer')}
          >
            {t('rq.action.transfer')}
          </button>
        )}
      </div>
      {canRaise && cancellable && (
        <div className="field field--inline">
          <label htmlFor="rq-cancel-reason">{t('rq.cancel.reason')}</label>
          <input
            id="rq-cancel-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="button button--ghost button--small"
            disabled={step.isPending || reason.trim() === ''}
            onClick={() => step.mutate('cancel')}
          >
            {t('rq.action.cancel')}
          </button>
        </div>
      )}
    </article>
  );
}

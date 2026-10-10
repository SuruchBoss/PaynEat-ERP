// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listUnits, unitName } from '@/features/items/items.api';
import { listLocations } from '@/features/locations/locations.api';
import { listProductionBoms } from '@/features/production-boms/production-boms.api';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import type { ApiError } from '@/lib/api-error';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  cancelProductionOrder,
  createProductionOrder,
  getProductionOrder,
  listProductionOrders,
  recordActuals,
  reverseProductionOrder,
  stepProductionOrder,
  type ActualsInput,
  type Blocker,
  type InputLine,
  type OutputLine,
  type ProductionOrderStatus,
  type ProductionOrderView,
  type StatusFilter,
  type YieldView,
} from './production-orders.api';

/** Kept as keys, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const ERRORS: Record<string, MessageKey> = {
  DOCUMENT_CHANGED: 'mo.error.changed',
  STEP_NOT_ALLOWED: 'mo.error.step',
  EXPIRED_LOT: 'mo.error.expiredLot',
  INVALID_PLANNED_QUANTITY: 'mo.error.plannedQuantity',
  NO_BOM_VERSION_IN_FORCE: 'mo.error.noVersion',
  WRONG_LOCATION_TYPE: 'mo.error.locationType',
  BOM_INACTIVE: 'mo.error.bomInactive',
  LOCATION_INACTIVE: 'mo.error.locationInactive',
  CANCELLATION_REASON_MISSING: 'mo.error.reason',
  BUSINESS_DATE_IN_FUTURE: 'mo.rule.business_date_in_future',
  INVALID_DATE: 'mo.error.invalid',
  VALIDATION_FAILED: 'mo.error.invalid',
};

/** Why an order cannot post, by the ledger's rule names (backend `posting-rules.ts`). */
const RULES: Record<string, MessageKey> = {
  nothing_picked: 'mo.rule.nothing_picked',
  expired_lot: 'mo.rule.expired_lot',
  weight_required: 'mo.rule.weight_required',
  pieces_required: 'mo.rule.pieces_required',
  actuals_missing: 'mo.rule.actuals_missing',
  zero_output_quantity: 'mo.rule.zero_output_quantity',
  negative_stock_plant: 'mo.rule.negative_stock_plant',
  inactive_item: 'mo.rule.inactive_item',
  not_released: 'mo.error.step',
  business_date_in_future: 'mo.rule.business_date_in_future',
  already_reversed: 'mo.rule.already_reversed',
  business_date_before_original: 'mo.rule.business_date_before_original',
  stale_revision: 'mo.error.changed',
  already_posted: 'mo.error.step',
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
  if (error.code === 'INVALID_PRODUCTION_LINE') {
    return {
      key: details?.side === 'output' ? 'mo.error.outputLine' : 'mo.error.inputLine',
      params: { lineNo: Number(details?.lineNo ?? 0), problem: error.message },
    };
  }
  return undefined;
}

const STATUS: Record<ProductionOrderStatus, { key: MessageKey; tone: string }> = {
  draft: { key: 'mo.status.draft', tone: 'badge--neutral' },
  released: { key: 'mo.status.released', tone: 'badge--neutral' },
  posted: { key: 'mo.status.posted', tone: 'badge--up' },
  cancelled: { key: 'mo.status.cancelled', tone: 'badge--down' },
};

const FILTERS: StatusFilter[] = ['all', 'draft', 'released', 'posted', 'cancelled'];

function StatusBadge({ status }: { status: ProductionOrderStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS[status].tone}`}>{t(STATUS[status].key)}</span>;
}

/** Actual against expected, in percent; nothing measured yet reads as such. */
function Yield({ value }: { value: YieldView }) {
  const { t } = useI18n();
  if (value.actual === null) {
    return (
      <span className="subtle">{t('mo.yield.expectedOnly', { expected: value.expected })}</span>
    );
  }
  const below = value.difference !== null && value.difference.startsWith('-');
  return (
    <span>
      {t('mo.yield.actual', { actual: value.actual, expected: value.expected })}
      <span className={below ? 'badge badge--down badge--inline' : 'badge badge--up badge--inline'}>
        {t('mo.yield.difference', { difference: value.difference ?? '' })}
      </span>
    </span>
  );
}

/**
 * Production orders (#13): a plant supervisor raises one from a BOM, releases it to pick input
 * lots first-expired-first-out (changing them if the floor did, never to an expired lot), records
 * what really came out, sees the yield and what each output lot will cost, and posts. Finance
 * reads them. A posted order is corrected only by reversal.
 */
export function ProductionOrdersPage() {
  const { t, language } = useI18n();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canRun = permissions.includes(Permission.PRODUCTION_ORDER_RUN);
  const [status, setStatus] = useState<StatusFilter>('all');
  const orders = useQuery({
    queryKey: qk.productionOrderList(status),
    queryFn: () => listProductionOrders(status),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <section className="page page--wide" aria-labelledby="mo-title">
      <div className="page__header">
        <div>
          <h1 id="mo-title">{t('mo.title')}</h1>
          <p className="muted">{t('mo.intro')}</p>
        </div>
        {canRun && !creating && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setOpenId(null);
              setNotice(null);
            }}
          >
            {t('mo.create.open')}
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
          onCreated={(order) => {
            setCreating(false);
            setOpenId(order.id);
            setNotice({ key: 'mo.created', params: { number: order.number } });
          }}
        />
      )}
      {openId && (
        <OrderPanel
          key={openId}
          id={openId}
          canRun={canRun}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      <div className="field field--inline">
        <label htmlFor="mo-status-filter">{t('mo.filter.label')}</label>
        <select
          id="mo-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'all' ? t('mo.filter.all') : t(STATUS[f].key)}
            </option>
          ))}
        </select>
      </div>

      {orders.isPending && (
        <p className="muted" role="status">
          {t('mo.loading')}
        </p>
      )}
      {orders.isError && <ErrorCallout error={orders.error} />}

      {orders.data && (
        <>
          <p className="subtle" role="status">
            {t('mo.count', { count: orders.data.length })}
          </p>
          {orders.data.length === 0 ? (
            <p className="muted">{t('mo.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('mo.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('mo.column.number')}</th>
                    <th scope="col">{t('mo.column.bom')}</th>
                    <th scope="col">{t('mo.column.location')}</th>
                    <th scope="col">{t('mo.column.date')}</th>
                    <th scope="col" className="numeric">
                      {t('mo.column.planned')}
                    </th>
                    <th scope="col">{t('mo.column.yield')}</th>
                    <th scope="col">{t('mo.column.status')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('mo.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data.map((order) => (
                    <tr
                      key={order.id}
                      className={order.status === 'cancelled' ? 'row--off' : undefined}
                    >
                      <th scope="row">
                        <code>{order.number}</code>
                      </th>
                      <td data-label={t('mo.column.bom')}>
                        <span>
                          {nameOf(order.bom)}{' '}
                          <span className="subtle">
                            <code>{order.bom.code}</code>{' '}
                            {t('mo.version', { number: order.bom.version.number })}
                          </span>
                        </span>
                      </td>
                      <td data-label={t('mo.column.location')}>
                        <span>
                          {nameOf(order.location)} <code>{order.location.code}</code>
                        </span>
                      </td>
                      <td className="nowrap" data-label={t('mo.column.date')}>
                        <span>{formatBusinessDate(order.businessDate, language)}</span>
                      </td>
                      <td className="numeric nowrap" data-label={t('mo.column.planned')}>
                        <span>
                          {groupDigits(order.plannedQuantity)}{' '}
                          <span className="subtle">{nameOf(order.plannedItem)}</span>
                        </span>
                      </td>
                      <td data-label={t('mo.column.yield')}>
                        <Yield value={order.yield} />
                      </td>
                      <td data-label={t('mo.column.status')}>
                        <StatusBadge status={order.status} />
                        {order.reversedBy && (
                          <span className="subtle">
                            {t('mo.reversedBy', { number: order.reversedBy.number })}
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('mo.open.label', { number: order.number })}
                          aria-expanded={openId === order.id}
                          onClick={() => {
                            setOpenId(openId === order.id ? null : order.id);
                            setCreating(false);
                            setNotice(null);
                          }}
                        >
                          {t('mo.open.short')}
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

/** A new draft: which BOM, at which plant, how much of its first input. */
function CreateForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (order: ProductionOrderView) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const boms = useQuery({
    queryKey: qk.productionBomList(false),
    queryFn: () => listProductionBoms(false),
  });
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const [bomId, setBomId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [planned, setPlanned] = useState('');
  const [businessDate, setBusinessDate] = useState('');
  const [note, setNote] = useState('');
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const plants = (locations.data ?? []).filter((l) => l.type === 'plant' && l.active);
  const runnable = (boms.data ?? []).filter((b) => b.current !== null);

  const create = useMutation({
    mutationFn: () =>
      createProductionOrder({
        bomId,
        locationId,
        plannedQuantity: planned.trim(),
        ...(businessDate ? { businessDate } : {}),
        note: note.trim(),
      }),
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: qk.productionOrders });
      onCreated(order);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form className="panel" aria-labelledby="mo-create-title" onSubmit={submit}>
      <h2 id="mo-create-title">{t('mo.create.title')}</h2>
      <p className="subtle">{t('mo.create.hint')}</p>
      <div className="field">
        <label htmlFor="mo-bom">{t('mo.field.bom')}</label>
        <select id="mo-bom" required value={bomId} onChange={(e) => setBomId(e.target.value)}>
          <option value="">{t('mo.field.choose')}</option>
          {runnable.map((bom) => (
            <option key={bom.id} value={bom.id}>
              {bom.code} · {nameOf(bom)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="mo-location">{t('mo.field.location')}</label>
        <select
          id="mo-location"
          required
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">{t('mo.field.choose')}</option>
          {plants.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code} · {nameOf(location)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="mo-planned">{t('mo.field.planned')}</label>
        <input
          id="mo-planned"
          inputMode="decimal"
          required
          aria-describedby="mo-planned-hint"
          value={planned}
          onChange={(e) => setPlanned(e.target.value)}
        />
        <p id="mo-planned-hint" className="subtle">
          {t('mo.field.plannedHint')}
        </p>
      </div>
      <div className="field">
        <label htmlFor="mo-date">{t('mo.field.date')}</label>
        <DateField
          id="mo-date"
          describedBy="mo-date-hint"
          value={businessDate}
          onChange={setBusinessDate}
        />
        <p id="mo-date-hint" className="subtle">
          {t('mo.field.dateHint')}
        </p>
      </div>
      <div className="field">
        <label htmlFor="mo-note">{t('mo.field.note')}</label>
        <input
          id="mo-note"
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
          {t('mo.create.submit')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('mo.close')}
        </button>
      </div>
    </form>
  );
}

function OrderPanel({
  id,
  canRun,
  onClose,
  onNotice,
}: {
  id: string;
  canRun: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t } = useI18n();
  const order = useQuery({
    queryKey: qk.productionOrder(id),
    queryFn: () => getProductionOrder(id),
  });
  if (order.isPending) {
    return (
      <p className="muted" role="status">
        {t('mo.loadingOne')}
      </p>
    );
  }
  if (order.isError) return <ErrorCallout error={order.error} />;
  return (
    <OrderDocument
      key={order.data.revision}
      order={order.data}
      canRun={canRun}
      onClose={onClose}
      onNotice={onNotice}
    />
  );
}

/** What the supervisor is typing for one input: a quantity and pieces per lot, and a weight. */
interface InputState {
  picks: Record<string, { quantity: string; pieces: string }>;
  weightKg: string;
}

interface OutputState {
  quantity: string;
  pieces: string;
  weightKg: string;
}

function initialInputs(order: ProductionOrderView): Record<number, InputState> {
  return Object.fromEntries(
    order.inputs.map((input) => [
      input.lineNo,
      {
        picks: Object.fromEntries(
          input.picks.map((p) => [p.lotId, { quantity: p.quantity, pieces: p.pieces ?? '' }]),
        ),
        weightKg: input.weightKg ?? '',
      },
    ]),
  );
}

function initialOutputs(order: ProductionOrderView): Record<number, OutputState> {
  return Object.fromEntries(
    order.outputs.map((output) => [
      output.lineNo,
      {
        quantity: output.actualQuantity ?? '',
        pieces: output.actualPieces ?? '',
        weightKg: output.actualWeightKg ?? '',
      },
    ]),
  );
}

function OrderDocument({
  order,
  canRun,
  onClose,
  onNotice,
}: {
  order: ProductionOrderView;
  canRun: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const editable = canRun && order.status === 'released';
  const [inputs, setInputs] = useState(() => initialInputs(order));
  const [outputs, setOutputs] = useState(() => initialOutputs(order));
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');
  const [reverseNote, setReverseNote] = useState('');
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const unit = (code: string) => unitName(units.data ?? [], code, language);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.productionOrders });
    await queryClient.invalidateQueries({ queryKey: qk.stockOnHandAll });
  };
  const after = (key: MessageKey) => async (result: ProductionOrderView) => {
    await refresh();
    onNotice({ key, params: { number: result.number } });
  };

  const step = useMutation({
    mutationFn: (name: 'release' | 'post') => stepProductionOrder(order.id, name, order.revision),
    onSuccess: async (result) => {
      await after(result.status === 'posted' ? 'mo.posted' : 'mo.released')(result);
    },
  });
  const save = useMutation({
    mutationFn: () => recordActuals(order.id, order.revision, actualsOf(order, inputs, outputs)),
    onSuccess: after('mo.saved'),
  });
  const cancel = useMutation({
    mutationFn: () => cancelProductionOrder(order.id, order.revision, reason.trim()),
    onSuccess: after('mo.cancelledNotice'),
  });
  const reverse = useMutation({
    mutationFn: () => reverseProductionOrder(order.id, reverseNote.trim()),
    onSuccess: async (result) => {
      await refresh();
      onNotice({
        key: 'mo.reversedNotice',
        params: { number: result.order.number, reversal: result.reversal.number },
      });
    },
  });
  const busy = step.isPending || save.isPending || cancel.isPending || reverse.isPending;
  const by = (record: { by: { displayName: string }; at: string }) =>
    t('mo.view.by', { name: record.by.displayName, time: formatDateTime(record.at, language) });

  const setPick = (lineNo: number, lotId: string, field: 'quantity' | 'pieces', value: string) => {
    setDirty(true);
    setInputs((all) => {
      const input = all[lineNo];
      const pick = input.picks[lotId] ?? { quantity: '', pieces: '' };
      return {
        ...all,
        [lineNo]: { ...input, picks: { ...input.picks, [lotId]: { ...pick, [field]: value } } },
      };
    });
  };
  const setOutput = (lineNo: number, field: keyof OutputState, value: string) => {
    setDirty(true);
    setOutputs((all) => ({ ...all, [lineNo]: { ...all[lineNo], [field]: value } }));
  };

  return (
    <section className="panel" aria-labelledby={`mo-view-title-${order.id}`}>
      <h2 id={`mo-view-title-${order.id}`} ref={headingRef} tabIndex={-1}>
        {t('mo.view.title', { number: order.number })} <StatusBadge status={order.status} />
      </h2>
      <dl className="facts">
        <div>
          <dt>{t('mo.column.bom')}</dt>
          <dd>
            {nameOf(order.bom)} <code>{order.bom.code}</code>{' '}
            {t('mo.versionFrom', {
              number: order.bom.version.number,
              date: formatBusinessDate(order.bom.version.effectiveFrom, language),
            })}
          </dd>
        </div>
        <div>
          <dt>{t('mo.column.location')}</dt>
          <dd>
            {nameOf(order.location)} <code>{order.location.code}</code>
          </dd>
        </div>
        <div>
          <dt>{t('mo.column.date')}</dt>
          <dd>{formatBusinessDate(order.businessDate, language)}</dd>
        </div>
        <div>
          <dt>{t('mo.view.created')}</dt>
          <dd>{by({ by: order.createdBy, at: order.createdAt })}</dd>
        </div>
        {order.released && (
          <div>
            <dt>{t('mo.view.released')}</dt>
            <dd>{by(order.released)}</dd>
          </div>
        )}
        {order.postedBy && order.postedAt && (
          <div>
            <dt>{t('mo.view.postedBy')}</dt>
            <dd>{by({ by: order.postedBy, at: order.postedAt })}</dd>
          </div>
        )}
        {order.cancelled && (
          <div>
            <dt>{t('mo.view.cancelled')}</dt>
            <dd>
              {by(order.cancelled)}
              <span className="subtle"> · {order.cancelled.reason}</span>
            </dd>
          </div>
        )}
        {order.reversedBy && (
          <div>
            <dt>{t('mo.view.reversal')}</dt>
            <dd>
              <code>{order.reversedBy.number}</code>
            </dd>
          </div>
        )}
        {order.note && (
          <div>
            <dt>{t('mo.field.note')}</dt>
            <dd>{order.note}</dd>
          </div>
        )}
        <div>
          <dt>{t('mo.view.yield')}</dt>
          <dd>
            <Yield value={order.yield} />
          </dd>
        </div>
        <div>
          <dt>{t('mo.view.inputValue')}</dt>
          <dd>{groupDigits(order.inputValue)}</dd>
        </div>
      </dl>

      <h3>{t('mo.inputs.title')}</h3>
      {order.status === 'draft' && <p className="subtle">{t('mo.inputs.suggested')}</p>}
      {order.inputs.map((input) => (
        <InputSection
          key={input.lineNo}
          input={input}
          state={inputs[input.lineNo]}
          editable={editable}
          unit={unit(input.item.baseUnitCode)}
          onPick={(lotId, field, value) => setPick(input.lineNo, lotId, field, value)}
          onWeight={(value) => {
            setDirty(true);
            setInputs((all) => ({
              ...all,
              [input.lineNo]: { ...all[input.lineNo], weightKg: value },
            }));
          }}
        />
      ))}

      <h3>{t('mo.outputs.title')}</h3>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">
            {t('mo.outputs.caption', { number: order.number })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('mo.column.item')}</th>
              <th scope="col" className="numeric">
                {t('mo.column.planned')}
              </th>
              <th scope="col" className="numeric">
                {t('mo.column.ratio')}
              </th>
              <th scope="col">{t('mo.column.actual')}</th>
              <th scope="col">{t('mo.column.yield')}</th>
              <th scope="col">{t('mo.column.cost')}</th>
              <th scope="col">{t('mo.column.expiry')}</th>
            </tr>
          </thead>
          <tbody>
            {order.outputs.map((output) => (
              <OutputRow
                key={output.lineNo}
                output={output}
                state={outputs[output.lineNo]}
                editable={editable}
                unit={unit(output.item.baseUnitCode)}
                onChange={(field, value) => setOutput(output.lineNo, field, value)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {(order.status === 'draft' || order.status === 'released') && (
        <Blockers blockers={order.blockers} order={order} />
      )}

      {order.status === 'posted' && order.genealogy.length > 0 && (
        <details className="disclosure">
          <summary>{t('mo.genealogy.title', { count: order.genealogy.length })}</summary>
          <ul className="plain-list">
            {order.genealogy.map((link) => (
              <li key={`${link.outputLot.id}-${link.inputLot.id}`}>
                {t('mo.genealogy.link', {
                  output: link.outputLot.number,
                  input: link.inputLot.number,
                  quantity: groupDigits(link.inputQuantity),
                })}
                {link.reversed && <span className="subtle"> {t('mo.genealogy.reversed')}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="panel__footer">
        {canRun && order.status === 'draft' && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => step.mutate('release')}
          >
            {t('mo.release.open')}
          </button>
        )}
        {editable && (
          <>
            <button
              type="button"
              className="button button--ghost"
              disabled={busy || !dirty}
              onClick={() => save.mutate()}
            >
              {t('mo.save.open')}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || dirty || order.blockers.length > 0}
              onClick={() => step.mutate('post')}
            >
              {t('mo.post.open')}
            </button>
            {dirty && <p className="subtle">{t('mo.save.first')}</p>}
          </>
        )}
        {step.isError && (
          <ErrorCallout error={step.error} messages={ERRORS} describe={describeError} />
        )}
        {save.isError && (
          <ErrorCallout error={save.error} messages={ERRORS} describe={describeError} />
        )}

        {canRun && (order.status === 'draft' || order.status === 'released') && (
          <>
            <div className="field">
              <label htmlFor={`mo-cancel-reason-${order.id}`}>{t('mo.cancel.label')}</label>
              <input
                id={`mo-cancel-reason-${order.id}`}
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
                {t('mo.cancel.open')}
              </button>
            </div>
          </>
        )}
        {cancel.isError && (
          <ErrorCallout error={cancel.error} messages={ERRORS} describe={describeError} />
        )}

        {canRun && order.status === 'posted' && !order.reversedBy && (
          <>
            <div className="field">
              <label htmlFor={`mo-reverse-note-${order.id}`}>{t('mo.reverse.label')}</label>
              <input
                id={`mo-reverse-note-${order.id}`}
                maxLength={500}
                value={reverseNote}
                onChange={(e) => setReverseNote(e.target.value)}
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => reverse.mutate()}
              >
                {t('mo.reverse.open')}
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
          {t('mo.close')}
        </button>
      </div>
    </section>
  );
}

/** The lots one input is taken from: recorded or suggested, and, while released, every choice. */
function InputSection({
  input,
  state,
  editable,
  unit,
  onPick,
  onWeight,
}: {
  input: InputLine;
  state: InputState;
  editable: boolean;
  unit: string;
  onPick: (lotId: string, field: 'quantity' | 'pieces', value: string) => void;
  onWeight: (value: string) => void;
}) {
  const { t, language } = useI18n();
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const picked = new Set(input.picks.map((p) => p.lotId));
  const rows = editable
    ? [
        ...input.availableLots,
        ...input.picks
          .filter((p) => !input.availableLots.some((l) => l.lotId === p.lotId))
          .map((p) => ({
            lotId: p.lotId,
            number: p.number,
            expiryDate: p.expiryDate,
            expired: false,
            unitCost: p.unitCost,
            available: '0',
            availablePieces: null,
          })),
      ]
    : input.picks.map((p) => ({
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
          <span className="cell-title">{nameOf(input.item)}</span> <code>{input.item.code}</code>{' '}
          <span className="subtle">
            {t('mo.inputs.planned', { quantity: groupDigits(input.plannedQuantity), unit })}
            {' · '}
            {t('mo.inputs.taken', { quantity: groupDigits(input.quantity), unit })}
            {input.shortBy !== null && /[1-9]/.test(input.shortBy) && (
              <> · {t('mo.inputs.short', { quantity: groupDigits(input.shortBy), unit })}</>
            )}
          </span>
          {input.picksOverridden && (
            <span className="badge badge--neutral badge--inline">{t('mo.inputs.overridden')}</span>
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('mo.column.lot')}</th>
            <th scope="col">{t('mo.column.expiry')}</th>
            {editable && (
              <th scope="col" className="numeric">
                {t('mo.column.available')}
              </th>
            )}
            <th scope="col" className="numeric">
              {t('mo.column.take')}
            </th>
            {input.item.variableWeight && <th scope="col">{t('mo.column.pieces')}</th>}
            <th scope="col" className="numeric">
              {t('mo.column.unitCost')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6}>{t('mo.inputs.none')}</td>
            </tr>
          )}
          {rows.map((lot) => {
            const pick = input.picks.find((p) => p.lotId === lot.lotId);
            const typed = state.picks[lot.lotId];
            return (
              <tr key={lot.lotId} className={lot.expired ? 'row--off' : undefined}>
                <th scope="row">
                  <code>{lot.number}</code>
                  {lot.expired && (
                    <span className="badge badge--down badge--inline">{t('mo.lot.expired')}</span>
                  )}
                </th>
                <td className="nowrap" data-label={t('mo.column.expiry')}>
                  {formatBusinessDate(lot.expiryDate, language)}
                </td>
                {editable && (
                  <td className="numeric nowrap" data-label={t('mo.column.available')}>
                    {groupDigits(lot.available ?? '0')} {unit}
                    {lot.availablePieces && (
                      <span className="subtle">
                        {t('mo.pieces', { pieces: groupDigits(lot.availablePieces) })}
                      </span>
                    )}
                  </td>
                )}
                <td className="numeric nowrap" data-label={t('mo.column.take')}>
                  {editable && !lot.expired ? (
                    <input
                      className="input--narrow"
                      inputMode="decimal"
                      aria-label={t('mo.take.label', { lot: lot.number })}
                      value={typed?.quantity ?? ''}
                      onChange={(e) => onPick(lot.lotId, 'quantity', e.target.value)}
                    />
                  ) : pick ? (
                    `${groupDigits(pick.quantity)} ${unit}`
                  ) : (
                    '—'
                  )}
                </td>
                {input.item.variableWeight && (
                  <td className="nowrap" data-label={t('mo.column.pieces')}>
                    {editable && !lot.expired ? (
                      <input
                        className="input--narrow"
                        inputMode="numeric"
                        aria-label={t('mo.pieces.label', { lot: lot.number })}
                        value={typed?.pieces ?? ''}
                        onChange={(e) => onPick(lot.lotId, 'pieces', e.target.value)}
                      />
                    ) : (
                      (pick?.pieces ?? '—')
                    )}
                  </td>
                )}
                <td className="numeric nowrap" data-label={t('mo.column.unitCost')}>
                  {groupDigits(lot.unitCost)}
                  {picked.has(lot.lotId) && pick && (
                    <span className="subtle">
                      {t('mo.value', { value: groupDigits(pick.value) })}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {input.item.weighed && (
        <div className="field field--inline">
          <label htmlFor={`mo-input-weight-${input.lineNo}`}>{t('mo.field.weightKg')}</label>
          {editable ? (
            <input
              id={`mo-input-weight-${input.lineNo}`}
              className="input--narrow"
              inputMode="decimal"
              value={state.weightKg}
              onChange={(e) => onWeight(e.target.value)}
            />
          ) : (
            <span>{input.weightKg ?? '—'}</span>
          )}
        </div>
      )}
    </div>
  );
}

function OutputRow({
  output,
  state,
  editable,
  unit,
  onChange,
}: {
  output: OutputLine;
  state: OutputState;
  editable: boolean;
  unit: string;
  onChange: (field: keyof OutputState, value: string) => void;
}) {
  const { t, language } = useI18n();
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const field = (name: keyof OutputState, label: MessageKey, mode: 'decimal' | 'numeric') => (
    <label className="inline-input">
      <span className="subtle">{t(label)}</span>
      <input
        className="input--narrow"
        inputMode={mode}
        aria-label={`${t(label)} · ${output.item.code}`}
        value={state[name]}
        onChange={(e) => onChange(name, e.target.value)}
      />
    </label>
  );
  return (
    <tr>
      <th scope="row">
        <span className="cell-title">{nameOf(output.item)}</span>
        <span className="subtle">
          <code>{output.item.code}</code>
          {output.lot && (
            <>
              {' '}
              {t('mo.view.lot')} <code>{output.lot.number}</code>
            </>
          )}
        </span>
      </th>
      <td className="numeric nowrap" data-label={t('mo.column.planned')}>
        {groupDigits(output.plannedQuantity)} {unit}
      </td>
      <td className="numeric nowrap" data-label={t('mo.column.ratio')}>
        {output.allocationRatio} %
      </td>
      <td data-label={t('mo.column.actual')}>
        {editable ? (
          <span className="stack">
            {field('quantity', 'mo.field.quantity', 'decimal')}
            {output.item.variableWeight && field('pieces', 'mo.field.pieces', 'numeric')}
            {output.item.weighed && field('weightKg', 'mo.field.weightKg', 'decimal')}
          </span>
        ) : output.actualQuantity !== null ? (
          <span>
            {groupDigits(output.actualQuantity)} {unit}
            {output.actualPieces && (
              <span className="subtle">
                {t('mo.pieces', { pieces: groupDigits(output.actualPieces) })}
              </span>
            )}
            {output.actualWeightKg && (
              <span className="subtle">{t('mo.weight', { kg: output.actualWeightKg })}</span>
            )}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td data-label={t('mo.column.yield')}>
        <Yield value={output.yield} />
      </td>
      <td className="nowrap" data-label={t('mo.column.cost')}>
        {output.cost ? (
          <span>
            {t('mo.cost.unit', { cost: groupDigits(output.cost.unitCost), unit })}
            <span className="subtle">
              {t('mo.cost.allocated', { value: groupDigits(output.cost.allocatedValue) })}
            </span>
            <span className="subtle">
              {t('mo.cost.rounding', { value: output.cost.roundingDifference })}
            </span>
          </span>
        ) : (
          <span className="subtle">{t('mo.cost.notYet')}</span>
        )}
      </td>
      <td className="nowrap" data-label={t('mo.column.expiry')}>
        {output.expiry ? (
          <span>
            {formatBusinessDate(output.expiry.expiryDate, language)}
            {output.expiry.expiryDate !== output.expiry.computedExpiryDate && (
              <span className="subtle">
                {t('mo.expiry.capped', {
                  computed: formatBusinessDate(output.expiry.computedExpiryDate, language),
                })}
              </span>
            )}
          </span>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

/** What would refuse the order now, in words. */
function Blockers({ blockers, order }: { blockers: Blocker[]; order: ProductionOrderView }) {
  const { t, language } = useI18n();
  if (blockers.length === 0) {
    return <p className="callout callout--success">{t('mo.blockers.none')}</p>;
  }
  const lineName = (blocker: Blocker) => {
    const line =
      blocker.side === 'output'
        ? order.outputs.find((o) => o.lineNo === blocker.lineNo)
        : order.inputs.find((i) => i.lineNo === blocker.lineNo);
    return line ? (language === 'th' ? line.item.nameTh : line.item.nameEn) : '';
  };
  return (
    <div className="callout" role="status">
      <p>{t('mo.blockers.title')}</p>
      <ul className="plain-list">
        {blockers.map((blocker) => (
          <li key={`${blocker.rule}-${blocker.side}-${blocker.lineNo}`}>
            {t(RULES[blocker.rule] ?? 'mo.error.step', { lineNo: blocker.lineNo ?? 0, lot: '' })}
            {blocker.lineNo !== undefined && <span className="subtle"> · {lineName(blocker)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The lots and actuals as the API takes them; empty boxes are left out or sent as nothing. */
function actualsOf(
  order: ProductionOrderView,
  inputs: Record<number, InputState>,
  outputs: Record<number, OutputState>,
): ActualsInput {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    inputs: order.inputs.map((input) => ({
      lineNo: input.lineNo,
      picks: Object.entries(inputs[input.lineNo].picks)
        .filter(([, pick]) => pick.quantity.trim() !== '' && pick.quantity.trim() !== '0')
        .map(([lotId, pick]) => ({
          lotId,
          quantity: pick.quantity.trim(),
          pieces: text(pick.pieces),
        })),
      weightKg: text(inputs[input.lineNo].weightKg),
    })),
    outputs: order.outputs.map((output) => ({
      lineNo: output.lineNo,
      quantity: text(outputs[output.lineNo].quantity),
      pieces: text(outputs[output.lineNo].pieces),
      weightKg: text(outputs[output.lineNo].weightKg),
    })),
  };
}

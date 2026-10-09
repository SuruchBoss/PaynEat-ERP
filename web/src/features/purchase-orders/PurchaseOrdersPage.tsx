// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listItems, listUnits, unitName } from '@/features/items/items.api';
import { listLocations } from '@/features/locations/locations.api';
import { getCompanySettings } from '@/features/settings/company-settings.api';
import { listSuppliers } from '@/features/suppliers/suppliers.api';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import type { ApiError } from '@/lib/api-error';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  createPurchaseOrder,
  decidePurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  stepPurchaseOrder,
  updatePurchaseOrder,
  type PurchaseOrderStatus,
  type PurchaseOrderView,
  type StatusFilter,
} from './purchase-orders.api';

/** Kept as a key, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const ERRORS: Record<string, MessageKey> = {
  PURCHASE_ORDER_CHANGED: 'po.error.changed',
  STEP_NOT_ALLOWED: 'po.error.step',
  UNKNOWN_SUPPLIER: 'po.error.supplier',
  SUPPLIER_INACTIVE: 'po.rule.inactive_supplier',
  UNKNOWN_LOCATION: 'po.error.location',
  LOCATION_INACTIVE: 'po.rule.inactive_location',
  LOCATION_NOT_RECEIVING: 'po.rule.location_not_receiving',
  DELIVERY_DATE_PAST: 'po.error.datePast',
  DELIVERY_DATE_INVALID: 'po.error.date',
  VALIDATION_FAILED: 'po.error.invalid',
  REJECTION_REASON_MISSING: 'po.error.reason',
  CANCELLATION_REASON_MISSING: 'po.error.reason',
};

/** Why an order was refused, by its rule (backend `purchase-order-rules.ts`). */
const RULES: Record<string, MessageKey> = {
  self_approval: 'po.rule.self_approval',
  empty_order: 'po.rule.empty_order',
  inactive_supplier: 'po.rule.inactive_supplier',
  inactive_location: 'po.rule.inactive_location',
  location_not_receiving: 'po.rule.location_not_receiving',
  inactive_item: 'po.rule.inactive_item',
  unit_not_purchase_unit: 'po.rule.unit_not_purchase_unit',
};

/** What is wrong with one line. */
const LINE_PROBLEMS: Record<string, MessageKey> = {
  QUANTITY_NOT_A_NUMBER: 'po.line.quantityNumber',
  QUANTITY_NOT_POSITIVE: 'po.line.quantityPositive',
  QUANTITY_TOO_PRECISE: 'po.line.quantityPrecise',
  QUANTITY_TOO_LARGE: 'po.line.tooLarge',
  PRICE_NOT_A_NUMBER: 'po.line.priceNumber',
  PRICE_NOT_POSITIVE: 'po.line.pricePositive',
  PRICE_TOO_PRECISE: 'po.line.pricePrecise',
  PRICE_TOO_LARGE: 'po.line.tooLarge',
  VAT_RATE_NOT_A_NUMBER: 'po.line.vatRate',
  VAT_RATE_OUT_OF_RANGE: 'po.line.vatRate',
  VAT_RATE_TOO_PRECISE: 'po.line.vatRate',
};

function describeError(error: ApiError): { key: MessageKey; params?: MessageParams } | undefined {
  const details = error.details as Record<string, unknown> | undefined;
  const lineNo = Number(details?.lineNo ?? 0);
  switch (error.code) {
    case 'PURCHASE_ORDER_REFUSED': {
      const key = RULES[String(details?.rule)];
      return key ? { key, params: { lineNo } } : undefined;
    }
    case 'INVALID_PURCHASE_ORDER_LINE': {
      const key = LINE_PROBLEMS[String(details?.problem)];
      return key ? { key, params: { lineNo } } : undefined;
    }
    case 'UNKNOWN_ITEM':
    case 'ITEM_INACTIVE':
      return { key: 'po.rule.inactive_item', params: { lineNo } };
    case 'NOT_A_PURCHASE_UNIT':
      return { key: 'po.rule.unit_not_purchase_unit', params: { lineNo } };
    default:
      return undefined;
  }
}

const STATUS: Record<PurchaseOrderStatus, { key: MessageKey; tone: string }> = {
  draft: { key: 'po.status.draft', tone: 'badge--neutral' },
  submitted: { key: 'po.status.submitted', tone: 'badge--neutral' },
  approved: { key: 'po.status.approved', tone: 'badge--up' },
  sent: { key: 'po.status.sent', tone: 'badge--up' },
  partially_received: { key: 'po.status.partially_received', tone: 'badge--up' },
  received: { key: 'po.status.received', tone: 'badge--up' },
  rejected: { key: 'po.status.rejected', tone: 'badge--down' },
  cancelled: { key: 'po.status.cancelled', tone: 'badge--down' },
};

const FILTERS: StatusFilter[] = [
  'all',
  'draft',
  'submitted',
  'approved',
  'sent',
  'partially_received',
  'received',
  'rejected',
  'cancelled',
];

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS[status].tone}`}>{t(STATUS[status].key)}</span>;
}

/**
 * Purchase orders (#10): what the company has ordered from its suppliers, for a plant or a
 * warehouse. Purchasing drafts and submits them; at or below the approval threshold submitting
 * approves them, above it a purchasing approver does — never the person who created the order
 * (ADR-0008). An order commits money, not stock.
 */
export function PurchaseOrdersPage() {
  const { t, language } = useI18n();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canRaise = permissions.includes(Permission.PURCHASE_ORDER_RAISE);
  const canApprove = permissions.includes(Permission.PURCHASE_ORDER_APPROVE);
  const [status, setStatus] = useState<StatusFilter>('all');
  const orders = useQuery({
    queryKey: qk.purchaseOrderList(status),
    queryFn: () => listPurchaseOrders(status),
  });
  const settings = useQuery({ queryKey: qk.companySettings, queryFn: getCompanySettings });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <section className="page page--wide" aria-labelledby="po-title">
      <div className="page__header">
        <div>
          <h1 id="po-title">{t('po.title')}</h1>
          <p className="muted">{t('po.intro')}</p>
          {settings.data && (
            <p className="subtle">
              {t('po.threshold', {
                amount: groupDigits(settings.data.purchaseApprovalThreshold),
              })}
            </p>
          )}
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
            {t('po.create.open')}
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
          onSaved={(order, n) => {
            setCreating(false);
            setOpenId(order.id);
            setNotice(n);
          }}
        />
      )}
      {openId && (
        <OrderPanel
          key={openId}
          id={openId}
          canRaise={canRaise}
          canApprove={canApprove}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      <div className="field field--inline">
        <label htmlFor="po-status-filter">{t('po.filter.label')}</label>
        <select
          id="po-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'all' ? t('po.filter.all') : t(STATUS[f].key)}
            </option>
          ))}
        </select>
      </div>

      {orders.isPending && (
        <p className="muted" role="status">
          {t('po.loading')}
        </p>
      )}
      {orders.isError && <ErrorCallout error={orders.error} />}

      {orders.data && (
        <>
          <p className="subtle" role="status">
            {t('po.count', { count: orders.data.length })}
          </p>
          {orders.data.length === 0 ? (
            <p className="muted">{t('po.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('po.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('po.column.number')}</th>
                    <th scope="col">{t('po.column.supplier')}</th>
                    <th scope="col">{t('po.column.deliverTo')}</th>
                    <th scope="col">{t('po.column.expected')}</th>
                    <th scope="col" className="numeric">
                      {t('po.column.gross')}
                    </th>
                    <th scope="col">{t('po.column.status')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('po.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data.map((order) => (
                    <tr
                      key={order.id}
                      className={
                        order.status === 'rejected' || order.status === 'cancelled'
                          ? 'row--off'
                          : undefined
                      }
                    >
                      <th scope="row">
                        <code>{order.number}</code>
                      </th>
                      <td data-label={t('po.column.supplier')}>
                        <span>
                          <span className="cell-title">{order.supplier.name}</span>
                          <span className="subtle">
                            <code>{order.supplier.code}</code>
                          </span>
                        </span>
                      </td>
                      <td data-label={t('po.column.deliverTo')}>
                        <span>
                          {nameOf(order.deliveryLocation)}{' '}
                          <code>{order.deliveryLocation.code}</code>
                        </span>
                      </td>
                      <td className="nowrap" data-label={t('po.column.expected')}>
                        <span>{formatBusinessDate(order.expectedDeliveryDate, language)}</span>
                      </td>
                      <td className="numeric nowrap" data-label={t('po.column.gross')}>
                        <span>{groupDigits(order.totals.gross)}</span>
                      </td>
                      <td data-label={t('po.column.status')}>
                        <StatusBadge status={order.status} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('po.open.label', { number: order.number })}
                          aria-expanded={openId === order.id}
                          onClick={() => {
                            setOpenId(openId === order.id ? null : order.id);
                            setCreating(false);
                            setNotice(null);
                          }}
                        >
                          {t('po.open.short')}
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

/** One order: its draft form for whoever may raise, or the order and its next step. */
function OrderPanel({
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
  const order = useQuery({ queryKey: qk.purchaseOrder(id), queryFn: () => getPurchaseOrder(id) });

  if (order.isPending) {
    return (
      <p className="muted" role="status">
        {t('po.loadingOne')}
      </p>
    );
  }
  if (order.isError) return <ErrorCallout error={order.error} />;
  if (order.data.status === 'draft' && canRaise) {
    return (
      <>
        <DraftForm
          key={order.data.revision}
          order={order.data}
          onClose={onClose}
          onSaved={(_saved, notice) => onNotice(notice)}
        />
        <OrderDocument
          order={order.data}
          canRaise={canRaise}
          canApprove={canApprove}
          onClose={onClose}
          onNotice={onNotice}
          compact
        />
      </>
    );
  }
  return (
    <OrderDocument
      key={order.data.revision}
      order={order.data}
      canRaise={canRaise}
      canApprove={canApprove}
      onClose={onClose}
      onNotice={onNotice}
    />
  );
}

interface LineState {
  key: number;
  itemId: string;
  unitCode: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  vatRecoverable: boolean;
}

let nextLineKey = 1;
const blankLine = (): LineState => ({
  key: nextLineKey++,
  itemId: '',
  unitCode: '',
  quantity: '',
  unitPrice: '',
  vatRate: '7',
  vatRecoverable: true,
});

/** A new draft, or a saved one to edit. */
function DraftForm({
  order,
  onClose,
  onSaved,
}: {
  order?: PurchaseOrderView;
  onClose: () => void;
  onSaved: (order: PurchaseOrderView, notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const suppliers = useQuery({ queryKey: qk.suppliers, queryFn: listSuppliers });
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const [supplierId, setSupplierId] = useState(order?.supplier.id ?? '');
  const [locationId, setLocationId] = useState(order?.deliveryLocation.id ?? '');
  const [expected, setExpected] = useState(order?.expectedDeliveryDate ?? '');
  const [note, setNote] = useState(order?.note ?? '');
  const [lines, setLines] = useState<LineState[]>(
    order && order.lines.length > 0
      ? order.lines.map((line) => ({
          key: nextLineKey++,
          itemId: line.item.id,
          unitCode: line.unit.code,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatRate: line.vatRate,
          vatRecoverable: line.vatRecoverable,
        }))
      : [blankLine()],
  );

  useEffect(() => headingRef.current?.focus(), []);

  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const activeSuppliers = (suppliers.data ?? []).filter(
    (s) => s.active || s.id === order?.supplier.id,
  );
  const receiving = (locations.data ?? []).filter(
    (l) => (l.active && (l.type === 'plant' || l.type === 'warehouse')) || l.id === locationId,
  );
  // Only items in use that are bought in some unit can be ordered.
  const orderable = (items.data ?? []).filter((i) => i.active && i.purchaseUnits.length > 0);
  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
  const setLine = (key: number, change: Partial<LineState>) =>
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const input = () => ({
    supplierId,
    deliveryLocationId: locationId,
    expectedDeliveryDate: expected,
    note: note.trim(),
    lines: lines
      .filter((line) => line.itemId || line.quantity || line.unitPrice)
      .map(({ key: _key, ...line }) => ({
        ...line,
        quantity: line.quantity.trim(),
        unitPrice: line.unitPrice.trim(),
        vatRate: line.vatRate.trim(),
      })),
  });

  const save = useMutation({
    mutationFn: () =>
      order ? updatePurchaseOrder(order.id, order.revision, input()) : createPurchaseOrder(input()),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: qk.purchaseOrders });
      onSaved(saved, {
        key: order ? 'po.saved' : 'po.created',
        params: { number: saved.number },
      });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  const titleId = order ? 'po-draft-title' : 'po-new-title';

  return (
    <form className="panel" onSubmit={onSubmit} aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {order ? t('po.draft.title', { number: order.number }) : t('po.create.title')}
      </h2>
      <p className="subtle">{t('po.draft.hint')}</p>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="po-supplier">{t('po.field.supplier')}</label>
          <select
            id="po-supplier"
            required
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">{t('po.field.chooseSupplier')}</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="po-location">{t('po.field.deliverTo')}</label>
          <select
            id="po-location"
            required
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">{t('po.field.chooseLocation')}</option>
            {receiving.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {nameOf(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="po-expected">{t('po.field.expected')}</label>
          <DateField
            id="po-expected"
            describedBy="po-expected-hint"
            value={expected}
            onChange={setExpected}
          />
          <p id="po-expected-hint" className="subtle">
            {t('po.field.expectedHint')}
          </p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="po-note">{t('po.field.note')}</label>
        <textarea
          id="po-note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <fieldset className="document-lines">
        <legend>{t('po.lines.legend')}</legend>
        <p className="subtle">{t('po.lines.intro')}</p>
        {lines.map((line, index) => {
          const n = index + 1;
          const item = itemById.get(line.itemId);
          return (
            <div key={line.key} className="document-line">
              <div className="field">
                <label htmlFor={`po-item-${line.key}`}>{t('po.line.itemLabel', { n })}</label>
                <select
                  id={`po-item-${line.key}`}
                  value={line.itemId}
                  onChange={(e) => {
                    const chosen = itemById.get(e.target.value);
                    setLine(line.key, {
                      itemId: e.target.value,
                      unitCode: chosen?.purchaseUnits[0]?.unitCode ?? '',
                    });
                  }}
                >
                  <option value="">{t('po.line.chooseItem')}</option>
                  {orderable.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code} · {nameOf(i)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`po-unit-${line.key}`}>{t('po.line.unitLabel', { n })}</label>
                <select
                  id={`po-unit-${line.key}`}
                  value={line.unitCode}
                  disabled={!item}
                  onChange={(e) => setLine(line.key, { unitCode: e.target.value })}
                >
                  {(item?.purchaseUnits ?? []).map((p) => (
                    <option key={p.unitCode} value={p.unitCode}>
                      {t('po.line.unitOption', {
                        unit: unitName(units.data ?? [], p.unitCode, language),
                        factor: groupDigits(p.factor),
                        base: unitName(units.data ?? [], item?.baseUnitCode ?? '', language),
                      })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`po-quantity-${line.key}`}>
                  {t('po.line.quantityLabel', { n })}
                </label>
                <input
                  id={`po-quantity-${line.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.quantity}
                  onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`po-price-${line.key}`}>{t('po.line.priceLabel', { n })}</label>
                <input
                  id={`po-price-${line.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.unitPrice}
                  onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`po-vat-${line.key}`}>{t('po.line.vatLabel', { n })}</label>
                <input
                  id={`po-vat-${line.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.vatRate}
                  onChange={(e) => setLine(line.key, { vatRate: e.target.value })}
                />
              </div>
              <div className="field field--checkbox">
                <input
                  id={`po-recoverable-${line.key}`}
                  type="checkbox"
                  checked={line.vatRecoverable}
                  onChange={(e) => setLine(line.key, { vatRecoverable: e.target.checked })}
                />
                <label htmlFor={`po-recoverable-${line.key}`}>
                  {t('po.line.recoverableLabel', { n })}
                </label>
              </div>
              <button
                type="button"
                className="button button--ghost button--small"
                aria-label={t('po.line.removeLabel', { n })}
                onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
              >
                {t('po.line.remove')}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setLines((all) => [...all, blankLine()])}
        >
          {t('po.line.add')}
        </button>
      </fieldset>

      {save.isError && (
        <ErrorCallout error={save.error} messages={ERRORS} describe={describeError} />
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? t('po.saving') : t('po.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t(order ? 'po.close' : 'po.cancel')}
        </button>
      </div>
    </form>
  );
}

/** An order as it stands, and the next step for whoever may take it. */
function OrderDocument({
  order,
  canRaise,
  canApprove,
  onClose,
  onNotice,
  compact = false,
}: {
  order: PurchaseOrderView;
  canRaise: boolean;
  canApprove: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
  /** Under the draft form: only the money and the step, the form shows the rest. */
  compact?: boolean;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const me = useAuthStore((s) => s.user?.id);
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const [reason, setReason] = useState('');
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const ownOrder = order.createdBy.id === me;

  useEffect(() => {
    if (!compact) headingRef.current?.focus();
  }, [compact]);

  const done = async (result: PurchaseOrderView, key: MessageKey) => {
    await queryClient.invalidateQueries({ queryKey: qk.purchaseOrders });
    onNotice({ key, params: { number: result.number } });
  };
  const step = useMutation({
    mutationFn: (name: 'submit' | 'approve' | 'send') =>
      stepPurchaseOrder(order.id, name, order.revision),
    onSuccess: (result, name) =>
      done(
        result,
        name === 'submit'
          ? result.status === 'approved'
            ? 'po.submittedApproved'
            : 'po.submittedForApproval'
          : name === 'approve'
            ? 'po.approvedNotice'
            : 'po.sentNotice',
      ),
  });
  const decide = useMutation({
    mutationFn: (name: 'reject' | 'cancel') =>
      decidePurchaseOrder(order.id, name, order.revision, reason.trim()),
    onSuccess: (result, name) =>
      done(result, name === 'reject' ? 'po.rejectedNotice' : 'po.cancelledNotice'),
  });
  const busy = step.isPending || decide.isPending;
  const cancellable = ['draft', 'submitted', 'approved', 'sent'].includes(order.status);
  const by = (record: { by: { displayName: string } | null; at: string }) =>
    t('po.view.by', {
      name: record.by?.displayName ?? t('po.view.automatic'),
      time: formatDateTime(record.at, language),
    });

  return (
    <section className="panel" aria-labelledby={`po-view-title-${order.id}`}>
      <h2 id={`po-view-title-${order.id}`} ref={headingRef} tabIndex={-1}>
        {t(compact ? 'po.view.money' : 'po.view.title', { number: order.number })}{' '}
        <StatusBadge status={order.status} />
      </h2>
      {!compact && (
        <dl className="facts">
          <div>
            <dt>{t('po.column.supplier')}</dt>
            <dd>
              {order.supplier.name} <code>{order.supplier.code}</code>
            </dd>
          </div>
          <div>
            <dt>{t('po.column.deliverTo')}</dt>
            <dd>
              {nameOf(order.deliveryLocation)} <code>{order.deliveryLocation.code}</code>
            </dd>
          </div>
          <div>
            <dt>{t('po.column.expected')}</dt>
            <dd>{formatBusinessDate(order.expectedDeliveryDate, language)}</dd>
          </div>
          <div>
            <dt>{t('po.view.raised')}</dt>
            <dd>{by({ by: order.createdBy, at: order.createdAt })}</dd>
          </div>
          {order.submitted && (
            <div>
              <dt>{t('po.view.submitted')}</dt>
              <dd>{by(order.submitted)}</dd>
            </div>
          )}
          {order.approved && (
            <div>
              <dt>{t('po.view.approved')}</dt>
              <dd>{by(order.approved)}</dd>
            </div>
          )}
          {order.sent && (
            <div>
              <dt>{t('po.view.sent')}</dt>
              <dd>{by(order.sent)}</dd>
            </div>
          )}
          {order.rejected && (
            <div>
              <dt>{t('po.view.rejected')}</dt>
              <dd>
                {by(order.rejected)}
                <span className="subtle"> · {order.rejected.reason}</span>
              </dd>
            </div>
          )}
          {order.cancelled && (
            <div>
              <dt>{t('po.view.cancelled')}</dt>
              <dd>
                {by(order.cancelled)}
                <span className="subtle"> · {order.cancelled.reason}</span>
              </dd>
            </div>
          )}
          {order.note && (
            <div>
              <dt>{t('po.field.note')}</dt>
              <dd>{order.note}</dd>
            </div>
          )}
        </dl>
      )}

      {order.lines.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">
              {t('po.view.caption', { number: order.number })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('po.column.item')}</th>
                <th scope="col" className="numeric">
                  {t('po.column.quantity')}
                </th>
                <th scope="col" className="numeric">
                  {t('po.column.price')}
                </th>
                <th scope="col" className="numeric">
                  {t('po.column.net')}
                </th>
                <th scope="col" className="numeric">
                  {t('po.column.vat')}
                </th>
                <th scope="col" className="numeric">
                  {t('po.column.gross')}
                </th>
                <th scope="col" className="numeric">
                  {t('po.column.unitCost')}
                </th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => {
                const unit = unitName(units.data ?? [], line.unit.code, language);
                const base = unitName(units.data ?? [], line.item.baseUnitCode, language);
                return (
                  <tr key={line.lineNo}>
                    <th scope="row">
                      <span className="cell-title">{nameOf(line.item)}</span>
                      <span className="subtle">
                        <code>{line.item.code}</code>
                      </span>
                    </th>
                    <td className="numeric nowrap" data-label={t('po.column.quantity')}>
                      <span>
                        {groupDigits(line.quantity)} {unit}
                        <span className="subtle">
                          {groupDigits(line.baseQuantity)} {base}
                        </span>
                      </span>
                    </td>
                    <td className="numeric nowrap" data-label={t('po.column.price')}>
                      <span>{groupDigits(line.unitPrice)}</span>
                    </td>
                    <td className="numeric nowrap" data-label={t('po.column.net')}>
                      <span>{groupDigits(line.net)}</span>
                    </td>
                    <td className="numeric nowrap" data-label={t('po.column.vat')}>
                      <span>
                        {groupDigits(line.vat)}
                        <span className="subtle">
                          {t(line.vatRecoverable ? 'po.vat.recoverable' : 'po.vat.notRecoverable', {
                            rate: line.vatRate,
                          })}
                        </span>
                      </span>
                    </td>
                    <td className="numeric nowrap" data-label={t('po.column.gross')}>
                      <span>{groupDigits(line.gross)}</span>
                    </td>
                    <td className="numeric nowrap" data-label={t('po.column.unitCost')}>
                      <span>
                        {t('po.unitCost', { cost: groupDigits(line.unitCost), unit: base })}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  {t('po.total')}
                </th>
                <td className="numeric nowrap">{groupDigits(order.totals.net)}</td>
                <td className="numeric nowrap">{groupDigits(order.totals.vat)}</td>
                <td className="numeric nowrap">
                  <strong>{groupDigits(order.totals.gross)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {order.status === 'draft' && (
        <p className="subtle">
          {t(order.approval.needsApprover ? 'po.approval.needed' : 'po.approval.automatic', {
            amount: groupDigits(order.approval.threshold),
          })}
        </p>
      )}

      <div className="panel__footer">
        {canRaise && order.status === 'draft' && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => step.mutate('submit')}
          >
            {t('po.submit.open')}
          </button>
        )}
        {canApprove &&
          order.status === 'submitted' &&
          (ownOrder ? (
            <p className="callout">{t('po.approve.own')}</p>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => step.mutate('approve')}
            >
              {t('po.approve.open')}
            </button>
          ))}
        {canRaise && order.status === 'approved' && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => step.mutate('send')}
          >
            {t('po.send.open')}
          </button>
        )}
        {step.isError && (
          <ErrorCallout error={step.error} messages={ERRORS} describe={describeError} />
        )}

        {((canApprove && order.status === 'submitted' && !ownOrder) ||
          (canRaise && cancellable)) && (
          <>
            <div className="field">
              <label htmlFor={`po-reason-${order.id}`}>{t('po.reason.label')}</label>
              <input
                id={`po-reason-${order.id}`}
                maxLength={500}
                aria-describedby={`po-reason-hint-${order.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p id={`po-reason-hint-${order.id}`} className="subtle">
                {t('po.reason.hint')}
              </p>
            </div>
            <div className="actions">
              {canApprove && order.status === 'submitted' && !ownOrder && (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy || !reason.trim()}
                  onClick={() => decide.mutate('reject')}
                >
                  {t('po.reject.open')}
                </button>
              )}
              {canRaise && cancellable && (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy || !reason.trim()}
                  onClick={() => decide.mutate('cancel')}
                >
                  {t('po.cancelOrder.open')}
                </button>
              )}
            </div>
          </>
        )}
        {decide.isError && (
          <ErrorCallout error={decide.error} messages={ERRORS} describe={describeError} />
        )}
      </div>
      {!compact && (
        <div className="actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            {t('po.close')}
          </button>
        </div>
      )}
    </section>
  );
}

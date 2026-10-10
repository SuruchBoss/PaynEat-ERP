// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listItems, listUnits, unitName } from '@/features/items/items.api';
import {
  getPurchaseOrder,
  listPurchaseOrders,
  type PurchaseOrderView,
} from '@/features/purchase-orders/purchase-orders.api';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import type { ApiError } from '@/lib/api-error';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  createGoodsReceipt,
  getGoodsReceipt,
  listGoodsReceipts,
  previewGoodsReceipt,
  rejectGoodsReceipt,
  stepGoodsReceipt,
  updateGoodsReceipt,
  type Condition,
  type Finding,
  type GoodsReceiptInput,
  type GoodsReceiptLine,
  type GoodsReceiptStatus,
  type GoodsReceiptView,
  type SteppedGoodsReceiptView,
  type StatusFilter,
} from './goods-receipts.api';

/** Kept as keys, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
  tone: 'success' | 'warning';
  /** A second sentence: why the ledger did not post. */
  detail?: { key: MessageKey; params: MessageParams };
}

const ERRORS: Record<string, MessageKey> = {
  DOCUMENT_CHANGED: 'gr.error.changed',
  STEP_NOT_ALLOWED: 'gr.error.step',
  PURCHASE_ORDER_NOT_RECEIVABLE: 'gr.rule.order_not_receivable',
  UNKNOWN_PURCHASE_ORDER: 'gr.rule.order_not_receivable',
  BUSINESS_DATE_IN_FUTURE: 'gr.rule.business_date_in_future',
  INVALID_DATE: 'gr.error.invalid',
  VALIDATION_FAILED: 'gr.error.invalid',
  REJECTION_REASON_MISSING: 'gr.error.reason',
};

/** Why a receipt was refused, by its rule (backend `goods-receipt-rules.ts`, the ledger's rules). */
const RULES: Record<string, MessageKey> = {
  self_approval: 'gr.rule.self_approval',
  empty_document: 'gr.rule.empty_document',
  order_not_receivable: 'gr.rule.order_not_receivable',
  inactive_location: 'gr.rule.inactive_location',
  inactive_item: 'gr.rule.inactive_item',
  temperature_required: 'gr.rule.temperature_required',
  reason_required: 'gr.rule.reason_required',
  expired_on_arrival: 'gr.rule.expired_on_arrival',
  over_receipt: 'gr.rule.over_receipt',
  needs_approval: 'gr.rule.needs_approval',
  business_date_in_future: 'gr.rule.business_date_in_future',
  stale_revision: 'gr.error.changed',
  already_posted: 'gr.error.step',
  not_approved: 'gr.error.step',
};

/** What is wrong with one line (backend `goods-receipt-rules.ts`). */
const LINE_PROBLEMS: Record<string, MessageKey> = {
  COUNTED_NOT_A_NUMBER: 'gr.line.countedNumber',
  COUNTED_NOT_POSITIVE: 'gr.line.countedPositive',
  COUNTED_TOO_PRECISE: 'gr.line.tooPrecise',
  COUNTED_TOO_LARGE: 'gr.line.tooLarge',
  REJECTED_NOT_A_NUMBER: 'gr.line.rejected',
  REJECTED_NEGATIVE: 'gr.line.rejected',
  REJECTED_TOO_PRECISE: 'gr.line.tooPrecise',
  REJECTED_MORE_THAN_COUNTED: 'gr.line.rejected',
  PIECES_REQUIRED: 'gr.line.piecesRequired',
  PIECES_NOT_ALLOWED: 'gr.line.piecesNotAllowed',
  PIECES_NOT_A_WHOLE_NUMBER: 'gr.line.pieces',
  PIECES_NOT_POSITIVE: 'gr.line.pieces',
  REJECTED_PIECES_MORE_THAN_COUNTED: 'gr.line.pieces',
  PIECES_DO_NOT_MATCH_QUANTITY: 'gr.line.piecesMatch',
  TEMPERATURE_NOT_A_NUMBER: 'gr.line.temperature',
  TEMPERATURE_OUT_OF_RANGE: 'gr.line.temperature',
  TEMPERATURE_TOO_PRECISE: 'gr.line.temperature',
  CONDITION_UNKNOWN: 'gr.error.invalid',
  SUPPLIER_EXPIRY_INVALID: 'gr.line.expiry',
  REASON_TOO_LONG: 'gr.line.reasonLong',
};

function ruleMessage(rule: unknown, details?: Record<string, unknown>) {
  const key = RULES[String(rule)];
  return key ? { key, params: { lineNo: Number(details?.lineNo ?? 0) } } : undefined;
}

function describeError(error: ApiError): { key: MessageKey; params?: MessageParams } | undefined {
  const details = error.details as Record<string, unknown> | undefined;
  const lineNo = Number(details?.lineNo ?? 0);
  switch (error.code) {
    case 'POSTING_REFUSED':
      return ruleMessage(details?.rule, details);
    case 'INVALID_GOODS_RECEIPT_LINE': {
      const key = LINE_PROBLEMS[String(details?.problem)];
      return key ? { key, params: { lineNo } } : undefined;
    }
    case 'NOT_A_RECEIVING_UNIT':
      return { key: 'gr.line.unit', params: { lineNo } };
    case 'ITEM_INACTIVE':
      return { key: 'gr.rule.inactive_item', params: { lineNo } };
    case 'UNKNOWN_ORDER_LINE':
    case 'DUPLICATE_ORDER_LINE':
      return { key: 'gr.error.orderLine', params: { lineNo } };
    default:
      return undefined;
  }
}

const STATUS: Record<GoodsReceiptStatus, { key: MessageKey; tone: string }> = {
  draft: { key: 'gr.status.draft', tone: 'badge--neutral' },
  submitted: { key: 'gr.status.submitted', tone: 'badge--neutral' },
  approved: { key: 'gr.status.approved', tone: 'badge--up' },
  posted: { key: 'gr.status.posted', tone: 'badge--up' },
  rejected: { key: 'gr.status.rejected', tone: 'badge--down' },
};

const FILTERS: StatusFilter[] = ['all', 'draft', 'submitted', 'approved', 'posted', 'rejected'];

/** Orders a receipt may be raised against (#11). */
const RECEIVABLE = ['approved', 'sent', 'partially_received'];

function StatusBadge({ status }: { status: GoodsReceiptStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS[status].tone}`}>{t(STATUS[status].key)}</span>;
}

/** One finding in words, with its numbers. */
function findingMessage(
  finding: Finding,
  language: 'th' | 'en',
): { key: MessageKey; params: MessageParams } {
  switch (finding.code) {
    case 'over_quantity':
    case 'under_quantity':
      return finding.variancePercent === null
        ? { key: 'gr.finding.nothingExpected', params: {} }
        : {
            key: finding.code === 'over_quantity' ? 'gr.finding.over' : 'gr.finding.under',
            params: {
              variance: finding.variancePercent.replace('-', ''),
              limit: finding.limitPercent,
            },
          };
    case 'too_warm':
      return {
        key: 'gr.finding.tooWarm',
        params: { temperature: finding.temperature, limit: finding.limit },
      };
    case 'damaged':
      return { key: 'gr.finding.damaged', params: {} };
    case 'short_dated':
      return {
        key: 'gr.finding.shortDated',
        params: {
          supplier: formatBusinessDate(finding.supplierExpiry, language),
          computed: formatBusinessDate(finding.computedExpiry, language),
        },
      };
  }
}

function Findings({ findings }: { findings: readonly Finding[] }) {
  const { t, language } = useI18n();
  if (findings.length === 0) {
    return <span className="badge badge--up badge--inline">{t('gr.finding.none')}</span>;
  }
  return (
    <ul className="plain-list">
      {findings.map((finding) => {
        const message = findingMessage(finding, language);
        return (
          <li key={finding.code}>
            <span className="badge badge--down badge--inline">{t(`gr.code.${finding.code}`)}</span>{' '}
            {t(message.key, message.params)}
          </li>
        );
      })}
    </ul>
  );
}

/** Both dates and the one the lot takes (ADR-0014). */
function Expiry({ line }: { line: Pick<GoodsReceiptLine, 'expiry'> }) {
  const { t, language } = useI18n();
  const { expiry } = line;
  return (
    <span>
      {formatBusinessDate(expiry.expiryDate, language)}
      <span className="subtle">
        {t(expiry.takes === 'supplier' ? 'gr.expiry.supplier' : 'gr.expiry.computed', {
          computed: formatBusinessDate(expiry.computedExpiry, language),
          supplier: expiry.supplierExpiry
            ? formatBusinessDate(expiry.supplierExpiry, language)
            : '—',
        })}
      </span>
    </span>
  );
}

/**
 * Goods receipts (#11): what really arrived at the dock against a purchase order. The plant records
 * each line — counted quantity, pieces for variable-weight items, temperature, condition, the
 * supplier's expiry — and sees the findings as it types. A receipt within tolerance posts when it
 * is submitted; one with a finding needs a reason and a purchasing approver who did not raise it
 * (ADR-0008). What is turned away goes back to the supplier and never enters stock.
 */
export function GoodsReceiptsPage() {
  const { t, language } = useI18n();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canReceive = permissions.includes(Permission.GOODS_RECEIPT_RECEIVE);
  const canApprove = permissions.includes(Permission.GOODS_RECEIPT_APPROVE);
  const [status, setStatus] = useState<StatusFilter>('all');
  const receipts = useQuery({
    queryKey: qk.goodsReceiptList(status),
    queryFn: () => listGoodsReceipts(status),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <section className="page page--wide" aria-labelledby="gr-title">
      <div className="page__header">
        <div>
          <h1 id="gr-title">{t('gr.title')}</h1>
          <p className="muted">{t('gr.intro')}</p>
        </div>
        {canReceive && !creating && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setOpenId(null);
              setNotice(null);
            }}
          >
            {t('gr.create.open')}
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
        <ReceiveForm
          onClose={() => setCreating(false)}
          onSaved={(receipt, n) => {
            setCreating(false);
            setOpenId(receipt.id);
            setNotice(n);
          }}
        />
      )}
      {openId && (
        <ReceiptPanel
          key={openId}
          id={openId}
          canReceive={canReceive}
          canApprove={canApprove}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      <div className="field field--inline">
        <label htmlFor="gr-status-filter">{t('gr.filter.label')}</label>
        <select
          id="gr-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'all' ? t('gr.filter.all') : t(STATUS[f].key)}
            </option>
          ))}
        </select>
      </div>

      {receipts.isPending && (
        <p className="muted" role="status">
          {t('gr.loading')}
        </p>
      )}
      {receipts.isError && <ErrorCallout error={receipts.error} />}

      {receipts.data && (
        <>
          <p className="subtle" role="status">
            {t('gr.count', { count: receipts.data.length })}
          </p>
          {receipts.data.length === 0 ? (
            <p className="muted">{t('gr.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('gr.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('gr.column.number')}</th>
                    <th scope="col">{t('gr.column.order')}</th>
                    <th scope="col">{t('gr.column.location')}</th>
                    <th scope="col">{t('gr.column.date')}</th>
                    <th scope="col">{t('gr.column.findings')}</th>
                    <th scope="col" className="numeric">
                      {t('gr.column.value')}
                    </th>
                    <th scope="col">{t('gr.column.status')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('gr.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.data.map((receipt) => (
                    <tr
                      key={receipt.id}
                      className={receipt.status === 'rejected' ? 'row--off' : undefined}
                    >
                      <th scope="row">
                        <code>{receipt.number}</code>
                      </th>
                      <td data-label={t('gr.column.order')}>
                        <span>
                          <code>{receipt.purchaseOrder.number}</code>
                          <span className="subtle">{receipt.supplier.name}</span>
                        </span>
                      </td>
                      <td data-label={t('gr.column.location')}>
                        <span>
                          {nameOf(receipt.location)} <code>{receipt.location.code}</code>
                        </span>
                      </td>
                      <td className="nowrap" data-label={t('gr.column.date')}>
                        <span>{formatBusinessDate(receipt.businessDate, language)}</span>
                      </td>
                      <td data-label={t('gr.column.findings')}>
                        <span>
                          {receipt.linesWithFindings === 0
                            ? t('gr.findings.none')
                            : t('gr.findings.lines', { count: receipt.linesWithFindings })}
                        </span>
                      </td>
                      <td className="numeric nowrap" data-label={t('gr.column.value')}>
                        <span>{groupDigits(receipt.totalValue)}</span>
                      </td>
                      <td data-label={t('gr.column.status')}>
                        <StatusBadge status={receipt.status} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('gr.open.label', { number: receipt.number })}
                          aria-expanded={openId === receipt.id}
                          onClick={() => {
                            setOpenId(openId === receipt.id ? null : receipt.id);
                            setCreating(false);
                            setNotice(null);
                          }}
                        >
                          {t('gr.open.short')}
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

/** One receipt: its draft form for the receiver, or the receipt and its next step. */
function ReceiptPanel({
  id,
  canReceive,
  canApprove,
  onClose,
  onNotice,
}: {
  id: string;
  canReceive: boolean;
  canApprove: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t } = useI18n();
  const receipt = useQuery({ queryKey: qk.goodsReceipt(id), queryFn: () => getGoodsReceipt(id) });
  if (receipt.isPending) {
    return (
      <p className="muted" role="status">
        {t('gr.loadingOne')}
      </p>
    );
  }
  if (receipt.isError) return <ErrorCallout error={receipt.error} />;
  const document = (
    <ReceiptDocument
      key={receipt.data.revision}
      receipt={receipt.data}
      canReceive={canReceive}
      canApprove={canApprove}
      onClose={onClose}
      onNotice={onNotice}
      compact={receipt.data.status === 'draft' && canReceive}
    />
  );
  if (receipt.data.status === 'draft' && canReceive) {
    return (
      <>
        <ReceiveForm
          key={receipt.data.revision}
          receipt={receipt.data}
          onClose={onClose}
          onSaved={(_saved, notice) => onNotice(notice)}
        />
        {document}
      </>
    );
  }
  return document;
}

interface LineState {
  purchaseOrderLineNo: number;
  unitCode: string;
  counted: string;
  rejected: string;
  countedPieces: string;
  rejectedPieces: string;
  temperature: string;
  condition: Condition;
  supplierExpiry: string;
  reason: string;
}

/** A row for each order line; a line left without a counted quantity did not arrive. */
function initialLines(order: PurchaseOrderView, receipt?: GoodsReceiptView): LineState[] {
  return order.lines.map((orderLine) => {
    const saved = receipt?.lines.find((l) => l.purchaseOrderLineNo === orderLine.lineNo);
    if (saved) {
      return {
        purchaseOrderLineNo: orderLine.lineNo,
        unitCode: saved.unit.code,
        counted: saved.countedQuantity,
        rejected: /^0(\.0+)?$/.test(saved.rejectedQuantity) ? '' : saved.rejectedQuantity,
        countedPieces: saved.countedPieces ?? '',
        rejectedPieces:
          saved.rejectedPieces && saved.rejectedPieces !== '0' ? saved.rejectedPieces : '',
        temperature: saved.temperature ?? '',
        condition: saved.condition,
        supplierExpiry: saved.expiry.supplierExpiry ?? '',
        reason: saved.reason ?? '',
      };
    }
    return {
      purchaseOrderLineNo: orderLine.lineNo,
      unitCode: orderLine.unit.code,
      counted: '',
      rejected: '',
      countedPieces: '',
      rejectedPieces: '',
      temperature: '',
      condition: 'good',
      supplierExpiry: '',
      reason: '',
    };
  });
}

/**
 * What the form sends: only the lines with something counted. A variable-weight item sends its
 * piece counts (ADR-0005); any other item sends none.
 */
function inputOf(
  order: PurchaseOrderView,
  lines: LineState[],
  businessDate: string,
  note: string,
  variableWeight: (itemId: string) => boolean,
): GoodsReceiptInput {
  return {
    purchaseOrderId: order.id,
    ...(businessDate ? { businessDate } : {}),
    note: note.trim(),
    lines: lines
      .filter((line) => line.counted.trim())
      .map((line) => {
        const itemId = order.lines.find((l) => l.lineNo === line.purchaseOrderLineNo)!.item.id;
        const pieces = variableWeight(itemId);
        return {
          purchaseOrderLineNo: line.purchaseOrderLineNo,
          unitCode: line.unitCode,
          countedQuantity: line.counted.trim(),
          rejectedQuantity: line.rejected.trim() || '0',
          countedPieces: pieces ? line.countedPieces.trim() || null : null,
          rejectedPieces: pieces ? line.rejectedPieces.trim() || '0' : null,
          temperature: line.temperature.trim() || null,
          condition: line.condition,
          supplierExpiry: line.supplierExpiry || null,
          reason: line.reason.trim() || null,
        };
      }),
  };
}

/** Waits until typing stops before the value changes. */
function useSettled<T>(value: T, delay = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** A new receipt, or a saved draft to edit. */
function ReceiveForm({
  receipt,
  onClose,
  onSaved,
}: {
  receipt?: GoodsReceiptView;
  onClose: () => void;
  onSaved: (receipt: GoodsReceiptView, notice: Notice) => void;
}) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const orders = useQuery({
    queryKey: qk.purchaseOrderList('all'),
    queryFn: () => listPurchaseOrders('all'),
    enabled: !receipt,
  });
  const [orderId, setOrderId] = useState(receipt?.purchaseOrder.id ?? '');
  const order = useQuery({
    queryKey: qk.purchaseOrder(orderId),
    queryFn: () => getPurchaseOrder(orderId),
    enabled: orderId !== '',
  });

  useEffect(() => headingRef.current?.focus(), []);

  const receivable = (orders.data ?? []).filter((o) => RECEIVABLE.includes(o.status));
  const titleId = receipt ? 'gr-draft-title' : 'gr-new-title';

  return (
    <section className="panel" aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {receipt ? t('gr.draft.title', { number: receipt.number }) : t('gr.create.title')}
      </h2>
      <p className="subtle">{t('gr.draft.hint')}</p>
      {!receipt && (
        <div className="field">
          <label htmlFor="gr-order">{t('gr.field.order')}</label>
          <select id="gr-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">{t('gr.field.chooseOrder')}</option>
            {receivable.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number} · {o.supplier.name}
              </option>
            ))}
          </select>
          {orders.data && receivable.length === 0 && (
            <p className="subtle">{t('gr.field.noOrders')}</p>
          )}
        </div>
      )}
      {orders.isError && <ErrorCallout error={orders.error} />}
      {order.isError && <ErrorCallout error={order.error} />}
      {order.data && (
        <LinesForm
          key={order.data.id}
          order={order.data}
          receipt={receipt}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
      {!order.data && (
        <div className="actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            {t('gr.cancel')}
          </button>
        </div>
      )}
    </section>
  );
}

function LinesForm({
  order,
  receipt,
  onClose,
  onSaved,
}: {
  order: PurchaseOrderView;
  receipt?: GoodsReceiptView;
  onClose: () => void;
  onSaved: (receipt: GoodsReceiptView, notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const variableWeight = (itemId: string) =>
    items.data?.find((i) => i.id === itemId)?.variableWeight ?? false;
  const [businessDate, setBusinessDate] = useState(receipt?.businessDate ?? '');
  const [note, setNote] = useState(receipt?.note ?? '');
  const [lines, setLines] = useState<LineState[]>(() => initialLines(order, receipt));
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const setLine = (lineNo: number, change: Partial<LineState>) =>
    setLines((all) =>
      all.map((line) => (line.purchaseOrderLineNo === lineNo ? { ...line, ...change } : line)),
    );

  const input = inputOf(order, lines, businessDate, note, variableWeight);
  const settled = useSettled(JSON.stringify(input));
  const preview = useQuery({
    queryKey: qk.goodsReceiptPreview(settled),
    queryFn: () => previewGoodsReceipt(JSON.parse(settled) as GoodsReceiptInput),
    enabled: (JSON.parse(settled) as GoodsReceiptInput).lines.length > 0,
    retry: false,
  });
  const previewLine = (lineNo: number) =>
    preview.data?.lines.find((l) => l.purchaseOrderLineNo === lineNo);

  const save = useMutation({
    mutationFn: () =>
      receipt
        ? updateGoodsReceipt(receipt.id, receipt.revision, {
            businessDate: input.businessDate,
            note: input.note,
            lines: input.lines,
          })
        : createGoodsReceipt(input),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: qk.goodsReceipts });
      onSaved(saved, {
        key: receipt ? 'gr.saved' : 'gr.created',
        params: { number: saved.number },
        tone: 'success',
      });
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={onSubmit} aria-label={t('gr.lines.legend')}>
      <dl className="facts">
        <div>
          <dt>{t('gr.column.order')}</dt>
          <dd>
            <code>{order.number}</code> {order.supplier.name}
          </dd>
        </div>
        <div>
          <dt>{t('gr.column.location')}</dt>
          <dd>
            {nameOf(order.deliveryLocation)} <code>{order.deliveryLocation.code}</code>
          </dd>
        </div>
      </dl>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="gr-date">{t('gr.field.date')}</label>
          <DateField
            id="gr-date"
            describedBy="gr-date-hint"
            value={businessDate}
            onChange={setBusinessDate}
          />
          <p id="gr-date-hint" className="subtle">
            {t('gr.field.dateHint')}
          </p>
        </div>
        <div className="field">
          <label htmlFor="gr-note">{t('gr.field.note')}</label>
          <input
            id="gr-note"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="document-lines">
        <legend>{t('gr.lines.legend')}</legend>
        <p className="subtle">{t('gr.lines.intro')}</p>
        {order.lines.map((orderLine) => {
          const line = lines.find((l) => l.purchaseOrderLineNo === orderLine.lineNo)!;
          const n = orderLine.lineNo;
          const base = unitName(units.data ?? [], orderLine.item.baseUnitCode, language);
          const checked = previewLine(n);
          const pieces = variableWeight(orderLine.item.id);
          return (
            <div key={n} className="document-line document-line--stacked">
              <p className="cell-title">
                {nameOf(orderLine.item)} <code>{orderLine.item.code}</code>
                <span className="subtle">
                  {' '}
                  {t('gr.line.ordered', {
                    quantity: groupDigits(orderLine.quantity),
                    unit: unitName(units.data ?? [], orderLine.unit.code, language),
                    base: groupDigits(orderLine.baseQuantity),
                    baseUnit: base,
                    received: groupDigits(orderLine.receivedQuantity),
                  })}
                </span>
              </p>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor={`gr-counted-${n}`}>{t('gr.line.countedLabel', { n })}</label>
                  <input
                    id={`gr-counted-${n}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={line.counted}
                    onChange={(e) => setLine(n, { counted: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`gr-unit-${n}`}>{t('gr.line.unitLabel', { n })}</label>
                  <select
                    id={`gr-unit-${n}`}
                    value={line.unitCode}
                    onChange={(e) => setLine(n, { unitCode: e.target.value })}
                  >
                    <option value={orderLine.unit.code}>
                      {unitName(units.data ?? [], orderLine.unit.code, language)}
                    </option>
                    {orderLine.item.baseUnitCode !== orderLine.unit.code && (
                      <option value={orderLine.item.baseUnitCode}>{base}</option>
                    )}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`gr-rejected-${n}`}>{t('gr.line.rejectedLabel', { n })}</label>
                  <input
                    id={`gr-rejected-${n}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={line.rejected}
                    onChange={(e) => setLine(n, { rejected: e.target.value })}
                  />
                </div>
                {pieces && (
                  <>
                    <div className="field">
                      <label htmlFor={`gr-pieces-${n}`}>{t('gr.line.piecesLabel', { n })}</label>
                      <input
                        id={`gr-pieces-${n}`}
                        inputMode="numeric"
                        autoComplete="off"
                        aria-describedby={`gr-pieces-hint-${n}`}
                        value={line.countedPieces}
                        onChange={(e) => setLine(n, { countedPieces: e.target.value })}
                      />
                      <p id={`gr-pieces-hint-${n}`} className="subtle">
                        {t('gr.line.piecesHint')}
                      </p>
                    </div>
                    <div className="field">
                      <label htmlFor={`gr-rejected-pieces-${n}`}>
                        {t('gr.line.rejectedPiecesLabel', { n })}
                      </label>
                      <input
                        id={`gr-rejected-pieces-${n}`}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0"
                        value={line.rejectedPieces}
                        onChange={(e) => setLine(n, { rejectedPieces: e.target.value })}
                      />
                    </div>
                  </>
                )}
                <div className="field">
                  <label htmlFor={`gr-temperature-${n}`}>
                    {t('gr.line.temperatureLabel', { n })}
                  </label>
                  <input
                    id={`gr-temperature-${n}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={line.temperature}
                    onChange={(e) => setLine(n, { temperature: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`gr-condition-${n}`}>{t('gr.line.conditionLabel', { n })}</label>
                  <select
                    id={`gr-condition-${n}`}
                    value={line.condition}
                    onChange={(e) => setLine(n, { condition: e.target.value as Condition })}
                  >
                    <option value="good">{t('gr.condition.good')}</option>
                    <option value="damaged">{t('gr.condition.damaged')}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`gr-expiry-${n}`}>{t('gr.line.expiryLabel', { n })}</label>
                  <DateField
                    id={`gr-expiry-${n}`}
                    value={line.supplierExpiry}
                    onChange={(value) => setLine(n, { supplierExpiry: value })}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor={`gr-reason-${n}`}>{t('gr.line.reasonLabel', { n })}</label>
                <input
                  id={`gr-reason-${n}`}
                  maxLength={500}
                  value={line.reason}
                  onChange={(e) => setLine(n, { reason: e.target.value })}
                />
              </div>
              {checked && (
                <div className="inspection" aria-live="polite">
                  <p>
                    <strong>{t('gr.line.inspection')}</strong>{' '}
                    {t('gr.line.accepted', {
                      quantity: groupDigits(checked.acceptedBaseQuantity),
                      unit: base,
                      expected: groupDigits(checked.expectedBaseQuantity),
                    })}
                  </p>
                  <Findings findings={checked.findings} />
                  {checked.overReceipt && (
                    <p className="callout callout--danger">
                      {t('gr.rule.over_receipt', { lineNo: n })}
                    </p>
                  )}
                  <p className="subtle">
                    {t('gr.line.lotExpiry')} <Expiry line={checked} />
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>

      {preview.isError && (
        <ErrorCallout error={preview.error} messages={ERRORS} describe={describeError} />
      )}
      {preview.data && (
        <p className={preview.data.needsApproval ? 'callout' : 'subtle'}>
          {t(preview.data.needsApproval ? 'gr.approval.needed' : 'gr.approval.none')}
        </p>
      )}
      {save.isError && (
        <ErrorCallout error={save.error} messages={ERRORS} describe={describeError} />
      )}
      <div className="actions">
        <button
          type="submit"
          className="button"
          disabled={save.isPending || input.lines.length === 0}
        >
          {save.isPending ? t('gr.saving') : t('gr.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t(receipt ? 'gr.close' : 'gr.cancel')}
        </button>
      </div>
    </form>
  );
}

/** A receipt as it stands, and the next step for whoever may take it. */
function ReceiptDocument({
  receipt,
  canReceive,
  canApprove,
  onClose,
  onNotice,
  compact = false,
}: {
  receipt: GoodsReceiptView;
  canReceive: boolean;
  canApprove: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
  /** Under the draft form: only the findings and the step, the form shows the rest. */
  compact?: boolean;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const me = useAuthStore((s) => s.user?.id);
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const [reason, setReason] = useState('');
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const ownReceipt = receipt.createdBy.id === me;

  useEffect(() => {
    if (!compact) headingRef.current?.focus();
  }, [compact]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.goodsReceipts });
    await queryClient.invalidateQueries({ queryKey: qk.purchaseOrders });
    await queryClient.invalidateQueries({ queryKey: qk.stockOnHandAll });
  };
  const outcome = (result: SteppedGoodsReceiptView): Notice => {
    if (result.status === 'posted') {
      return {
        key: result.supplierReturn ? 'gr.postedWithReturn' : 'gr.posted',
        params: { number: result.number, ret: result.supplierReturn?.number ?? '' },
        tone: 'success',
      };
    }
    if (result.status === 'submitted') {
      return { key: 'gr.submittedForApproval', params: { number: result.number }, tone: 'success' };
    }
    return {
      key: 'gr.approvedNotPosted',
      params: { number: result.number },
      tone: 'warning',
      detail: result.postingRefusal
        ? ruleMessage(result.postingRefusal.rule, result.postingRefusal.details)
        : undefined,
    };
  };
  const step = useMutation({
    mutationFn: (name: 'submit' | 'approve' | 'post') =>
      stepGoodsReceipt(receipt.id, name, receipt.revision),
    onSuccess: async (result) => {
      await refresh();
      onNotice(outcome(result));
    },
  });
  const reject = useMutation({
    mutationFn: () => rejectGoodsReceipt(receipt.id, receipt.revision, reason.trim()),
    onSuccess: async (result) => {
      await refresh();
      onNotice({ key: 'gr.rejectedNotice', params: { number: result.number }, tone: 'success' });
    },
  });
  const busy = step.isPending || reject.isPending;
  const decidable =
    canApprove && !ownReceipt && (receipt.status === 'submitted' || receipt.status === 'approved');
  const by = (record: { by: { displayName: string }; at: string }) =>
    t('gr.view.by', { name: record.by.displayName, time: formatDateTime(record.at, language) });

  return (
    <section className="panel" aria-labelledby={`gr-view-title-${receipt.id}`}>
      <h2 id={`gr-view-title-${receipt.id}`} ref={headingRef} tabIndex={-1}>
        {t(compact ? 'gr.view.inspection' : 'gr.view.title', { number: receipt.number })}{' '}
        <StatusBadge status={receipt.status} />
      </h2>
      {!compact && (
        <dl className="facts">
          <div>
            <dt>{t('gr.column.order')}</dt>
            <dd>
              <code>{receipt.purchaseOrder.number}</code> {receipt.supplier.name}
            </dd>
          </div>
          <div>
            <dt>{t('gr.column.location')}</dt>
            <dd>
              {nameOf(receipt.location)} <code>{receipt.location.code}</code>
            </dd>
          </div>
          <div>
            <dt>{t('gr.column.date')}</dt>
            <dd>{formatBusinessDate(receipt.businessDate, language)}</dd>
          </div>
          <div>
            <dt>{t('gr.view.received')}</dt>
            <dd>{by({ by: receipt.createdBy, at: receipt.createdAt })}</dd>
          </div>
          {receipt.submitted && (
            <div>
              <dt>{t('gr.view.submitted')}</dt>
              <dd>{by(receipt.submitted)}</dd>
            </div>
          )}
          {receipt.approved && (
            <div>
              <dt>{t('gr.view.approved')}</dt>
              <dd>{by(receipt.approved)}</dd>
            </div>
          )}
          {receipt.rejected && (
            <div>
              <dt>{t('gr.view.rejected')}</dt>
              <dd>
                {by(receipt.rejected)}
                <span className="subtle"> · {receipt.rejected.reason}</span>
              </dd>
            </div>
          )}
          {receipt.supplierReturn && (
            <div>
              <dt>{t('gr.view.return')}</dt>
              <dd>
                <code>{receipt.supplierReturn.number}</code>
              </dd>
            </div>
          )}
          {receipt.note && (
            <div>
              <dt>{t('gr.field.note')}</dt>
              <dd>{receipt.note}</dd>
            </div>
          )}
        </dl>
      )}

      {receipt.lines.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">
              {t('gr.view.caption', { number: receipt.number })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('gr.column.item')}</th>
                <th scope="col" className="numeric">
                  {t('gr.column.counted')}
                </th>
                <th scope="col" className="numeric">
                  {t('gr.column.accepted')}
                </th>
                <th scope="col">{t('gr.column.dock')}</th>
                <th scope="col">{t('gr.column.findings')}</th>
                <th scope="col">{t('gr.column.expiry')}</th>
                <th scope="col" className="numeric">
                  {t('gr.column.value')}
                </th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line) => {
                const base = unitName(units.data ?? [], line.item.baseUnitCode, language);
                const unit = unitName(units.data ?? [], line.unit.code, language);
                return (
                  <tr key={line.lineNo}>
                    <th scope="row">
                      <span className="cell-title">{nameOf(line.item)}</span>
                      <span className="subtle">
                        <code>{line.item.code}</code>
                        {line.lot && (
                          <>
                            {' '}
                            {t('gr.view.lot')} <code>{line.lot.number}</code>
                          </>
                        )}
                      </span>
                    </th>
                    <td className="numeric nowrap" data-label={t('gr.column.counted')}>
                      <span>
                        {groupDigits(line.countedQuantity)} {unit}
                        {line.countedPieces && (
                          <span className="subtle">
                            {t('gr.view.pieces', { pieces: groupDigits(line.countedPieces) })}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="numeric nowrap" data-label={t('gr.column.accepted')}>
                      <span>
                        {groupDigits(line.acceptedBaseQuantity)} {base}
                        {line.acceptedPieces && (
                          <span className="subtle">
                            {t('gr.view.pieces', { pieces: groupDigits(line.acceptedPieces) })}
                          </span>
                        )}
                        {/[1-9]/.test(line.rejectedBaseQuantity) && (
                          <span className="subtle">
                            {t('gr.view.turnedAway', {
                              quantity: groupDigits(line.rejectedBaseQuantity),
                              unit: base,
                            })}
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label={t('gr.column.dock')}>
                      <span>
                        {line.temperature !== null
                          ? t('gr.view.temperature', { temperature: line.temperature })
                          : t('gr.view.noTemperature')}
                        <span className="subtle">{t(`gr.condition.${line.condition}`)}</span>
                        {line.reason && <span className="subtle">{line.reason}</span>}
                      </span>
                    </td>
                    <td data-label={t('gr.column.findings')}>
                      <Findings findings={line.findings} />
                    </td>
                    <td className="nowrap" data-label={t('gr.column.expiry')}>
                      <Expiry line={line} />
                    </td>
                    <td className="numeric nowrap" data-label={t('gr.column.value')}>
                      <span>
                        {groupDigits(line.value)}
                        <span className="subtle">
                          {t('gr.view.unitCost', { cost: groupDigits(line.unitCost), unit: base })}
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={6}>
                  {t('gr.total')}
                </th>
                <td className="numeric nowrap">
                  <strong>{groupDigits(receipt.totalValue)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {receipt.status === 'draft' && (
        <p className={receipt.needsApproval ? 'callout' : 'subtle'}>
          {t(receipt.needsApproval ? 'gr.approval.needed' : 'gr.approval.none')}
        </p>
      )}

      <div className="panel__footer">
        {canReceive && receipt.status === 'draft' && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => step.mutate('submit')}
          >
            {t(receipt.needsApproval ? 'gr.submit.forApproval' : 'gr.submit.post')}
          </button>
        )}
        {canApprove &&
          receipt.status === 'submitted' &&
          (ownReceipt ? (
            <p className="callout">{t('gr.approve.own')}</p>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => step.mutate('approve')}
            >
              {t('gr.approve.open')}
            </button>
          ))}
        {canApprove && receipt.status === 'approved' && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => step.mutate('post')}
          >
            {t('gr.post.open')}
          </button>
        )}
        {step.isError && (
          <ErrorCallout error={step.error} messages={ERRORS} describe={describeError} />
        )}

        {decidable && (
          <>
            <div className="field">
              <label htmlFor={`gr-reject-reason-${receipt.id}`}>{t('gr.reject.label')}</label>
              <input
                id={`gr-reject-reason-${receipt.id}`}
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
                onClick={() => reject.mutate()}
              >
                {t('gr.reject.open')}
              </button>
            </div>
          </>
        )}
        {reject.isError && (
          <ErrorCallout error={reject.error} messages={ERRORS} describe={describeError} />
        )}
      </div>
      {!compact && (
        <div className="actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            {t('gr.close')}
          </button>
        </div>
      )}
    </section>
  );
}

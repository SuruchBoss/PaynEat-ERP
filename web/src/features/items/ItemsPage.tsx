// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { ErrorCallout } from '@/components/ErrorCallout';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import { ApiError } from '@/lib/api-error';
import { useAuthStore } from '@/stores/auth.store';
import {
  createItem,
  listItems,
  listUnits,
  unitName,
  updateItem,
  type ItemView,
  type PurchaseUnit,
  type PurchaseUnitIssue,
  type UnitView,
} from './items.api';

type StatusFilter = 'active' | 'inactive' | 'all';

/** Kept as a key, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const SAVE_ERRORS: Record<string, MessageKey> = {
  ITEM_CODE_TAKEN: 'items.error.codeTaken',
  UNKNOWN_UNIT: 'items.error.unknownUnit',
  VALIDATION_FAILED: 'items.error.invalid',
  ITEM_CHANGED: 'items.error.changed',
  INVALID_PURCHASE_UNITS: 'items.error.purchaseUnits',
};

/** Why the API refused one purchase-unit row (backend `domain/item-rules.ts`). */
const PROBLEMS: Record<string, MessageKey> = {
  NOT_A_NUMBER: 'items.problem.NOT_A_NUMBER',
  NOT_POSITIVE: 'items.problem.NOT_POSITIVE',
  TOO_MANY_DECIMALS: 'items.problem.TOO_MANY_DECIMALS',
  TOO_LARGE: 'items.problem.TOO_LARGE',
  UNKNOWN_UNIT: 'items.problem.UNKNOWN_UNIT',
  SAME_AS_BASE_UNIT: 'items.problem.SAME_AS_BASE_UNIT',
  DUPLICATE: 'items.problem.DUPLICATE',
};

const FILTERS: Record<StatusFilter, MessageKey> = {
  active: 'items.filter.active',
  inactive: 'items.filter.inactive',
  all: 'items.filter.all',
};

/**
 * A typed factor as a person reads it, trimmed of trailing zeros, or null while it is not
 * a positive decimal: the preview never shows a conversion the API would refuse.
 */
function readableFactor(factor: string): string | null {
  const trimmed = factor.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed) || !/[1-9]/.test(trimmed)) return null;
  return trimmed.includes('.') ? trimmed.replace(/\.?0+$/, '') : trimmed;
}

function purchaseUnitIssues(error: unknown): PurchaseUnitIssue[] {
  if (!(error instanceof ApiError) || error.code !== 'INVALID_PURCHASE_UNITS') return [];
  const details = error.details as { issues?: PurchaseUnitIssue[] } | undefined;
  return details?.issues ?? [];
}

export function ItemsPage() {
  const { t, language } = useI18n();
  const canManage = useAuthStore((s) => s.user?.permissions.includes(Permission.ITEM_MANAGE));
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (items.data ?? []).filter(
      (item) =>
        (status === 'all' || item.active === (status === 'active')) &&
        (!needle ||
          [item.code, item.nameTh, item.nameEn].some((s) =>
            s.toLocaleLowerCase().includes(needle),
          )),
    );
  }, [items.data, search, status]);

  const editing = items.data?.find((i) => i.id === editingId) ?? null;
  const unitList = units.data ?? [];

  const openEditor = (id: string | null) => {
    setEditingId(id);
    setCreating(false);
    setNotice(null);
  };

  return (
    <section className="page page--wide" aria-labelledby="items-title">
      <div className="page__header">
        <div>
          <h1 id="items-title">{t('items.title')}</h1>
          <p className="muted">{t('items.intro')}</p>
        </div>
        {canManage && !creating && units.data && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
              setNotice(null);
            }}
          >
            {t('items.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}
        </p>
      )}

      {creating && units.data && (
        <ItemForm
          units={units.data}
          onClose={() => setCreating(false)}
          onSaved={(item) => {
            setCreating(false);
            setNotice({ key: 'items.create.done', params: { code: item.code } });
          }}
        />
      )}
      {canManage && editing && units.data && (
        <ItemForm
          key={editing.id}
          item={editing}
          units={units.data}
          onClose={() => setEditingId(null)}
          onSaved={(item, notice) => {
            setEditingId(null);
            setNotice(notice ?? { key: 'items.edit.done', params: { code: item.code } });
          }}
        />
      )}

      <div className="filters">
        <div className="field">
          <label htmlFor="items-search">{t('items.search')}</label>
          <input
            id="items-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="items-status">{t('items.filter')}</label>
          <select
            id="items-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            {(Object.keys(FILTERS) as StatusFilter[]).map((value) => (
              <option key={value} value={value}>
                {t(FILTERS[value])}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(items.isPending || units.isPending) && (
        <p className="muted" role="status">
          {t('items.loading')}
        </p>
      )}
      {items.isError && <ErrorCallout error={items.error} />}
      {units.isError && <ErrorCallout error={units.error} />}

      {items.data && units.data && (
        <>
          <p className="subtle" role="status">
            {t('items.count', { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <p className="muted">{t('items.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('items.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('items.column.item')}</th>
                    <th scope="col">{t('items.column.baseUnit')}</th>
                    <th scope="col">{t('items.column.purchaseUnits')}</th>
                    <th scope="col">{t('items.column.shelfLife')}</th>
                    <th scope="col">{t('items.column.status')}</th>
                    {canManage && (
                      <th scope="col">
                        <span className="visually-hidden">{t('items.column.actions')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((item) => {
                    const name = language === 'th' ? item.nameTh : item.nameEn;
                    const otherName = language === 'th' ? item.nameEn : item.nameTh;
                    return (
                      <tr key={item.id}>
                        <th scope="row">
                          <span className="cell-title">{name}</span>
                          <span className="subtle">
                            <code>{item.code}</code> {otherName}
                          </span>
                        </th>
                        <td>
                          {unitName(unitList, item.baseUnitCode, language)}
                          {item.variableWeight && (
                            <span className="badge badge--neutral badge--inline">
                              {t('items.variableWeight')}
                            </span>
                          )}
                        </td>
                        <td>
                          {item.purchaseUnits.length === 0 ? (
                            <span className="subtle">{t('items.noPurchaseUnits')}</span>
                          ) : (
                            <ul className="plain-list">
                              {item.purchaseUnits.map((p) => (
                                <li key={p.unitCode}>
                                  {t('items.conversion', {
                                    unit: unitName(unitList, p.unitCode, language),
                                    factor: p.factor,
                                    base: unitName(unitList, item.baseUnitCode, language),
                                  })}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td>
                          {item.shelfLifeDays === 1
                            ? t('items.shelfLife.oneDay')
                            : t('items.shelfLife.days', { days: item.shelfLifeDays })}
                        </td>
                        <td>
                          <span className={`badge badge--${item.active ? 'up' : 'neutral'}`}>
                            {t(item.active ? 'items.status.active' : 'items.status.inactive')}
                          </span>
                        </td>
                        {canManage && (
                          <td>
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              aria-label={t('items.edit.label', { name })}
                              aria-expanded={editingId === item.id}
                              onClick={() => openEditor(editingId === item.id ? null : item.id)}
                            >
                              {t('items.edit.short')}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface Row extends PurchaseUnit {
  /** Stable across removals, so React keeps each row's inputs with their row. */
  key: number;
}

function ItemForm({
  item,
  units,
  onClose,
  onSaved,
}: {
  /** The item being edited; absent when creating one. */
  item?: ItemView;
  units: UnitView[];
  onClose: () => void;
  onSaved: (item: ItemView, notice?: Notice) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nextKey = useRef(0);
  const withKey = (p: PurchaseUnit): Row => ({ ...p, key: nextKey.current++ });

  const [code, setCode] = useState(item?.code ?? '');
  const [nameTh, setNameTh] = useState(item?.nameTh ?? '');
  const [nameEn, setNameEn] = useState(item?.nameEn ?? '');
  const [baseUnitCode, setBaseUnitCode] = useState(item?.baseUnitCode ?? '');
  const [variableWeight, setVariableWeight] = useState(item?.variableWeight ?? false);
  const [shelfLifeDays, setShelfLifeDays] = useState(String(item?.shelfLifeDays ?? ''));
  const [rows, setRows] = useState<Row[]>(() => (item?.purchaseUnits ?? []).map(withKey));

  useEffect(() => headingRef.current?.focus(), []);

  const afterSave = async (saved: ItemView) => {
    await queryClient.invalidateQueries({ queryKey: qk.items });
    return saved;
  };
  const afterError = (error: unknown) => {
    // Someone else's change: fetch it, so closing and reopening shows the latest.
    if (error instanceof ApiError && error.code === 'ITEM_CHANGED') {
      void queryClient.invalidateQueries({ queryKey: qk.items });
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const fields = {
        nameTh: nameTh.trim(),
        nameEn: nameEn.trim(),
        variableWeight,
        shelfLifeDays: Number(shelfLifeDays),
        purchaseUnits: rows.map(({ unitCode, factor }) => ({ unitCode, factor: factor.trim() })),
      };
      return item
        ? updateItem(item.id, { version: item.version, ...fields })
        : createItem({ code: code.trim().toUpperCase(), baseUnitCode, ...fields });
    },
    onSuccess: async (saved) => onSaved(await afterSave(saved)),
    onError: afterError,
  });

  const toggleActive = useMutation({
    mutationFn: () => updateItem(item!.id, { version: item!.version, active: !item!.active }),
    onSuccess: async (saved) =>
      onSaved(await afterSave(saved), {
        key: saved.active ? 'items.reactivated' : 'items.deactivated',
        params: { code: saved.code },
      }),
    onError: afterError,
  });

  const issues = purchaseUnitIssues(save.error);
  const busy = save.isPending || toggleActive.isPending;
  const baseName = baseUnitCode ? unitName(units, baseUnitCode, language) : '';
  const titleId = item ? 'edit-item-title' : 'create-item-title';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    toggleActive.reset();
    save.mutate();
  };

  return (
    <form className="panel" onSubmit={submit} aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {item ? t('items.edit.title', { code: item.code }) : t('items.create.title')}
      </h2>
      {item && <p className="muted">{t('items.field.fixed')}</p>}

      <div className="field-grid">
        {!item && (
          <div className="field">
            <label htmlFor="item-code">{t('items.field.code')}</label>
            <input
              id="item-code"
              required
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              className="input--code"
              aria-describedby="item-code-hint"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <p id="item-code-hint" className="subtle">
              {t('items.field.codeHint')}
            </p>
          </div>
        )}
        {!item && (
          <div className="field">
            <label htmlFor="item-base-unit">{t('items.field.baseUnit')}</label>
            <select
              id="item-base-unit"
              required
              aria-describedby="item-base-unit-hint"
              value={baseUnitCode}
              onChange={(e) => setBaseUnitCode(e.target.value)}
            >
              <option value="">{t('items.selectUnit')}</option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {language === 'th' ? u.nameTh : u.nameEn}
                </option>
              ))}
            </select>
            <p id="item-base-unit-hint" className="subtle">
              {t('items.field.baseUnitHint')}
            </p>
          </div>
        )}
        <div className="field">
          <label htmlFor="item-name-th">{t('items.field.nameTh')}</label>
          <input
            id="item-name-th"
            lang="th"
            required
            maxLength={120}
            value={nameTh}
            onChange={(e) => setNameTh(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="item-name-en">{t('items.field.nameEn')}</label>
          <input
            id="item-name-en"
            lang="en"
            required
            maxLength={120}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="item-shelf-life">{t('items.field.shelfLife')}</label>
          <input
            id="item-shelf-life"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={36500}
            step={1}
            aria-describedby="item-shelf-life-hint"
            value={shelfLifeDays}
            onChange={(e) => setShelfLifeDays(e.target.value)}
          />
          <p id="item-shelf-life-hint" className="subtle">
            {t('items.field.shelfLifeHint')}
          </p>
        </div>
      </div>

      <div className="check-field">
        <input
          id="item-variable-weight"
          type="checkbox"
          checked={variableWeight}
          aria-describedby="item-variable-weight-hint"
          onChange={(e) => setVariableWeight(e.target.checked)}
        />
        <div>
          <label htmlFor="item-variable-weight" className="cell-title">
            {t('items.field.variableWeight')}
          </label>
          <p id="item-variable-weight-hint" className="subtle">
            {t('items.field.variableWeightHint')}
          </p>
        </div>
      </div>

      <fieldset className="purchase-units">
        <legend>{t('items.purchaseUnits.legend')}</legend>
        <p className="subtle">{t('items.purchaseUnits.intro')}</p>
        {rows.length === 0 && <p className="muted">{t('items.purchaseUnits.none')}</p>}
        {rows.map((row, index) => {
          const n = index + 1;
          const rowIssues = issues.filter((i) => i.index === index);
          const errorId = `purchase-unit-${row.key}-error`;
          const factor = readableFactor(row.factor);
          const update = (patch: Partial<PurchaseUnit>) =>
            setRows(rows.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
          return (
            <div key={row.key} className="purchase-unit-row">
              <div className="field">
                <label htmlFor={`purchase-unit-${row.key}-unit`}>
                  {t('items.purchaseUnits.unit', { n })}
                </label>
                <select
                  id={`purchase-unit-${row.key}-unit`}
                  required
                  aria-invalid={rowIssues.length > 0 || undefined}
                  aria-describedby={rowIssues.length > 0 ? errorId : undefined}
                  value={row.unitCode}
                  onChange={(e) => update({ unitCode: e.target.value })}
                >
                  <option value="">{t('items.selectUnit')}</option>
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {language === 'th' ? u.nameTh : u.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`purchase-unit-${row.key}-factor`}>
                  {t('items.purchaseUnits.factor', { base: baseName, n })}
                </label>
                <input
                  id={`purchase-unit-${row.key}-factor`}
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={rowIssues.length > 0 || undefined}
                  aria-describedby={rowIssues.length > 0 ? errorId : undefined}
                  value={row.factor}
                  onChange={(e) => update({ factor: e.target.value })}
                />
              </div>
              <p className="purchase-unit-row__preview subtle" aria-hidden="true">
                {row.unitCode && factor && baseName
                  ? t('items.conversion', {
                      unit: unitName(units, row.unitCode, language),
                      factor,
                      base: baseName,
                    })
                  : ''}
              </p>
              <button
                type="button"
                className="button button--ghost button--small"
                aria-label={t('items.purchaseUnits.removeLabel', { n })}
                onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
              >
                {t('items.purchaseUnits.remove')}
              </button>
              {rowIssues.length > 0 && (
                <p id={errorId} className="field-error purchase-unit-row__error">
                  {rowIssues
                    .map((i) => t(PROBLEMS[i.problem] ?? 'items.error.purchaseUnits'))
                    .join(' ')}
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setRows([...rows, withKey({ unitCode: '', factor: '' })])}
        >
          {t('items.purchaseUnits.add')}
        </button>
      </fieldset>

      {save.isError && <ErrorCallout error={save.error} messages={SAVE_ERRORS} />}
      {toggleActive.isError && <ErrorCallout error={toggleActive.error} messages={SAVE_ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {save.isPending
            ? t('items.saving')
            : t(item ? 'items.edit.submit' : 'items.create.submit')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t(item ? 'items.close' : 'items.cancel')}
        </button>
      </div>

      {item && (
        <div className="panel__footer">
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            aria-describedby={item.active ? 'item-deactivate-hint' : undefined}
            onClick={() => {
              save.reset();
              toggleActive.mutate();
            }}
          >
            {t(item.active ? 'items.deactivate' : 'items.reactivate')}
          </button>
          {item.active && (
            <p id="item-deactivate-hint" className="subtle">
              {t('items.deactivate.hint')}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

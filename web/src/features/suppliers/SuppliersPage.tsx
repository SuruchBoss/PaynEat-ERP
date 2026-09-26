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
  createSupplier,
  formatTaxId,
  listSuppliers,
  updateSupplier,
  type SupplierFields,
  type SupplierView,
} from './suppliers.api';

type StatusFilter = 'active' | 'inactive' | 'all';

/** Kept as a key, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const FILTERS: Record<StatusFilter, MessageKey> = {
  active: 'filter.active',
  inactive: 'filter.inactive',
  all: 'filter.all',
};

const ERRORS: Record<string, MessageKey> = {
  SUPPLIER_CODE_TAKEN: 'suppliers.error.codeTaken',
  INVALID_TAX_ID: 'suppliers.error.taxId',
  SUPPLIER_CHANGED: 'suppliers.error.changed',
  VALIDATION_FAILED: 'suppliers.error.invalid',
};

const CONTACT_FIELDS = [
  ['contactName', 'suppliers.field.contactName', 'text', 'name'],
  ['phone', 'suppliers.field.phone', 'tel', 'tel'],
  ['email', 'suppliers.field.email', 'email', 'email'],
] as const;

export function SuppliersPage() {
  const { t } = useI18n();
  const canManage = useAuthStore((s) => s.user?.permissions.includes(Permission.SUPPLIER_MANAGE));
  const suppliers = useQuery({ queryKey: qk.suppliers, queryFn: listSuppliers });
  const [status, setStatus] = useState<StatusFilter>('active');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const shown = useMemo(
    () =>
      (suppliers.data ?? []).filter((s) => status === 'all' || s.active === (status === 'active')),
    [suppliers.data, status],
  );
  const editing = suppliers.data?.find((s) => s.id === editingId) ?? null;

  return (
    <section className="page page--wide" aria-labelledby="suppliers-title">
      <div className="page__header">
        <div>
          <h1 id="suppliers-title">{t('suppliers.title')}</h1>
          <p className="muted">{t('suppliers.intro')}</p>
        </div>
        {canManage && !creating && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
              setNotice(null);
            }}
          >
            {t('suppliers.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}
        </p>
      )}

      {creating && (
        <SupplierForm
          onClose={() => setCreating(false)}
          onSaved={(n) => {
            setCreating(false);
            setNotice(n);
          }}
        />
      )}
      {canManage && editing && (
        <SupplierForm
          key={editing.id}
          supplier={editing}
          onClose={() => setEditingId(null)}
          onSaved={(n) => {
            setEditingId(null);
            setNotice(n);
          }}
        />
      )}

      <div className="filters">
        <div className="field">
          <label htmlFor="suppliers-status">{t('filter.show')}</label>
          <select
            id="suppliers-status"
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

      {suppliers.isPending && (
        <p className="muted" role="status">
          {t('suppliers.loading')}
        </p>
      )}
      {suppliers.isError && <ErrorCallout error={suppliers.error} />}

      {suppliers.data && (
        <>
          <p className="subtle" role="status">
            {t('suppliers.count', { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <p className="muted">{t('suppliers.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('suppliers.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('suppliers.column.supplier')}</th>
                    <th scope="col">{t('suppliers.column.taxId')}</th>
                    <th scope="col">{t('suppliers.column.contact')}</th>
                    <th scope="col">{t('suppliers.column.status')}</th>
                    {canManage && (
                      <th scope="col">
                        <span className="visually-hidden">{t('suppliers.column.actions')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((supplier) => (
                    <tr key={supplier.id} className={supplier.active ? undefined : 'row--off'}>
                      <th scope="row">
                        <span className="cell-title">{supplier.name}</span>
                        <span className="subtle">
                          <code>{supplier.code}</code>
                        </span>
                      </th>
                      <td className="nowrap" data-label={t('suppliers.column.taxId')}>
                        {formatTaxId(supplier.taxId)}
                      </td>
                      <td data-label={t('suppliers.column.contact')}>
                        {supplier.contactName || supplier.phone || supplier.email ? (
                          <ul className="plain-list">
                            {[supplier.contactName, supplier.phone, supplier.email]
                              .filter(Boolean)
                              .map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                          </ul>
                        ) : (
                          <span className="subtle">{t('suppliers.noContact')}</span>
                        )}
                      </td>
                      <td data-label={t('suppliers.column.status')}>
                        <span className={`badge badge--${supplier.active ? 'up' : 'neutral'}`}>
                          {t(supplier.active ? 'status.active' : 'status.inactive')}
                        </span>
                      </td>
                      {canManage && (
                        <td>
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            aria-label={t('suppliers.edit.label', { name: supplier.name })}
                            aria-expanded={editingId === supplier.id}
                            onClick={() => {
                              setEditingId(editingId === supplier.id ? null : supplier.id);
                              setCreating(false);
                              setNotice(null);
                            }}
                          >
                            {t('suppliers.edit.short')}
                          </button>
                        </td>
                      )}
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

function SupplierForm({
  supplier,
  onClose,
  onSaved,
}: {
  /** The supplier being edited; absent when creating one. */
  supplier?: SupplierView;
  onClose: () => void;
  onSaved: (notice: Notice) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState(supplier?.code ?? '');
  const [fields, setFields] = useState<SupplierFields>({
    name: supplier?.name ?? '',
    taxId: supplier ? formatTaxId(supplier.taxId) : '',
    contactName: supplier?.contactName ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
  });
  const set = (field: keyof SupplierFields) => (value: string) =>
    setFields((f) => ({ ...f, [field]: value }));

  useEffect(() => headingRef.current?.focus(), []);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.suppliers });
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'SUPPLIER_CHANGED') void refresh();
  };

  const save = useMutation({
    mutationFn: () => {
      const trimmed = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, v.trim()]),
      ) as unknown as SupplierFields;
      return supplier
        ? updateSupplier(supplier.id, { revision: supplier.revision, ...trimmed })
        : createSupplier({ code: code.trim().toUpperCase(), ...trimmed });
    },
    onSuccess: async (saved) => {
      await refresh();
      onSaved({
        key: supplier ? 'suppliers.edit.done' : 'suppliers.create.done',
        params: { code: saved.code },
      });
    },
    onError,
  });

  const toggle = useMutation({
    mutationFn: () =>
      updateSupplier(supplier!.id, { revision: supplier!.revision, active: !supplier!.active }),
    onSuccess: async (saved) => {
      await refresh();
      onSaved({
        key: saved.active ? 'suppliers.reactivated' : 'suppliers.deactivated',
        params: { code: saved.code },
      });
    },
    onError,
  });

  const busy = save.isPending || toggle.isPending;
  const titleId = supplier ? 'edit-supplier-title' : 'create-supplier-title';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    toggle.reset();
    save.mutate();
  };

  return (
    <form className="panel" onSubmit={submit} aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {supplier
          ? t('suppliers.edit.title', { code: supplier.code })
          : t('suppliers.create.title')}
      </h2>
      <div className="field-grid">
        {!supplier && (
          <div className="field">
            <label htmlFor="supplier-code">{t('suppliers.field.code')}</label>
            <input
              id="supplier-code"
              required
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              className="input--code"
              aria-describedby="supplier-code-hint"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <p id="supplier-code-hint" className="subtle">
              {t('suppliers.field.codeHint')}
            </p>
          </div>
        )}
        <div className="field">
          <label htmlFor="supplier-name">{t('suppliers.field.name')}</label>
          <input
            id="supplier-name"
            required
            maxLength={200}
            value={fields.name}
            onChange={(e) => set('name')(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="supplier-tax-id">{t('suppliers.field.taxId')}</label>
          <input
            id="supplier-tax-id"
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={32}
            aria-describedby="supplier-tax-id-hint"
            value={fields.taxId}
            onChange={(e) => set('taxId')(e.target.value)}
          />
          <p id="supplier-tax-id-hint" className="subtle">
            {t('suppliers.field.taxIdHint')}
          </p>
        </div>
        {CONTACT_FIELDS.map(([field, label, type, autoComplete]) => (
          <div key={field} className="field">
            <label htmlFor={`supplier-${field}`}>{t(label)}</label>
            <input
              id={`supplier-${field}`}
              type={type}
              autoComplete={`section-supplier ${autoComplete}`}
              maxLength={field === 'email' ? 255 : 120}
              value={fields[field]}
              onChange={(e) => set(field)(e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="supplier-address">{t('suppliers.field.address')}</label>
        <textarea
          id="supplier-address"
          rows={2}
          maxLength={500}
          value={fields.address}
          onChange={(e) => set('address')(e.target.value)}
        />
      </div>
      {save.isError && <ErrorCallout error={save.error} messages={ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {save.isPending
            ? t('suppliers.saving')
            : t(supplier ? 'suppliers.edit.submit' : 'suppliers.create.submit')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t(supplier ? 'suppliers.close' : 'suppliers.cancel')}
        </button>
      </div>
      {supplier && (
        <div className="panel__footer">
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => {
              save.reset();
              toggle.mutate();
            }}
          >
            {t(supplier.active ? 'suppliers.deactivate' : 'suppliers.reactivate')}
          </button>
          {toggle.isError && <ErrorCallout error={toggle.error} messages={ERRORS} />}
        </div>
      )}
    </form>
  );
}

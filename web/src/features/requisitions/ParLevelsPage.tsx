// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listItems, listUnits, unitName } from '@/features/items/items.api';
import { listLocations } from '@/features/locations/locations.api';
import type { MessageKey } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { getParMisses, listParLevels, removeParLevel, setParLevel } from './requisitions.api';

const PAR_ERRORS: Record<string, MessageKey> = {
  INVALID_PAR_LEVEL: 'par.error.quantity',
  NOT_A_BRANCH: 'rq.error.notBranch',
  ITEM_INACTIVE: 'par.error.inactive',
  PERIOD_IN_FUTURE: 'par.error.future',
  INVALID_PERIOD: 'par.error.period',
  INVALID_DATE: 'rq.error.invalid',
  VALIDATION_FAILED: 'rq.error.invalid',
};

/**
 * Par levels and par misses (#15, ADR-0009): how much of each item each branch should hold, which
 * the admin keeps, and how often each branch and item missed over a period: its balance went
 * below zero, or a requisition line was not fully dispatched by its needed-by date. A par level
 * that keeps missing is the one to change.
 */
export function ParLevelsPage() {
  const { t } = useI18n();
  return (
    <section className="page page--wide" aria-labelledby="par-title">
      <div className="page__header">
        <div>
          <h1 id="par-title">{t('par.title')}</h1>
          <p className="muted">{t('par.intro')}</p>
        </div>
      </div>
      <ParMisses />
      <ParLevels />
    </section>
  );
}

function ParMisses() {
  const { t, language } = useI18n();
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const branches = (locations.data ?? []).filter((l) => l.type === 'branch');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const query = { from, to, branchId };
  const report = useQuery({
    queryKey: qk.parMisses(JSON.stringify(query)),
    queryFn: () => getParMisses(query),
  });
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <div className="panel" aria-labelledby="par-misses-title" role="region">
      <h2 id="par-misses-title">{t('par.misses.title')}</h2>
      <p className="subtle">{t('par.misses.hint')}</p>
      <div className="filters">
        <div className="field">
          <label htmlFor="par-from">{t('par.misses.from')}</label>
          <DateField id="par-from" value={from} onChange={setFrom} compact />
        </div>
        <div className="field">
          <label htmlFor="par-to">{t('par.misses.to')}</label>
          <DateField id="par-to" value={to} onChange={setTo} compact />
        </div>
        <div className="field">
          <label htmlFor="par-branch">{t('rq.column.branch')}</label>
          <select id="par-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('par.misses.allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {nameOf(b)} ({b.code})
              </option>
            ))}
          </select>
        </div>
      </div>
      {report.isError && <ErrorCallout error={report.error} messages={PAR_ERRORS} />}
      {report.data && (
        <>
          <p className="subtle" role="status">
            {t('par.misses.period', {
              from: formatBusinessDate(report.data.from, language),
              to: formatBusinessDate(report.data.to, language),
            })}
          </p>
          {report.data.rows.length === 0 ? (
            <p className="muted">{t('par.misses.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('par.misses.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('rq.column.branch')}</th>
                    <th scope="col">{t('rq.column.item')}</th>
                    <th scope="col" className="numeric">
                      {t('rq.column.par')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('par.misses.negative')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('par.misses.lines')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row) => (
                    <tr key={`${row.branch.id}:${row.item.id}`}>
                      <td data-label={t('rq.column.branch')}>{row.branch.code}</td>
                      <td data-label={t('rq.column.item')}>
                        {nameOf(row.item)} <span className="subtle">({row.item.code})</span>
                      </td>
                      <td data-label={t('rq.column.par')} className="numeric">
                        {row.par === null ? t('rq.none') : groupDigits(row.par)}
                      </td>
                      <td data-label={t('par.misses.negative')} className="numeric">
                        {row.negativeEpisodes}
                      </td>
                      <td data-label={t('par.misses.lines')} className="numeric">
                        {t('par.misses.linesValue', {
                          missed: row.linesMissed,
                          due: row.linesDue,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ParLevels() {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((s) => s.user?.permissions ?? []).includes(
    Permission.PAR_LEVEL_MANAGE,
  );
  const levels = useQuery({ queryKey: qk.parLevels, queryFn: listParLevels });
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const branches = (locations.data ?? []).filter((l) => l.type === 'branch' && l.active);
  const [branchId, setBranchId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.parLevels });

  const save = useMutation({
    mutationFn: () => setParLevel(branchId, itemId, quantity.trim()),
    onSuccess: async () => {
      await refresh();
      setQuantity('');
    },
  });
  const remove = useMutation({
    mutationFn: (key: { locationId: string; itemId: string }) =>
      removeParLevel(key.locationId, key.itemId),
    onSuccess: refresh,
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <div className="panel" aria-labelledby="par-levels-title" role="region">
      <h2 id="par-levels-title">{t('par.levels.title')}</h2>
      <p className="subtle">{t('par.levels.hint')}</p>
      {canManage && (
        <form className="filters" onSubmit={onSubmit} aria-label={t('par.levels.formLabel')}>
          <div className="field">
            <label htmlFor="par-set-branch">{t('rq.column.branch')}</label>
            <select
              id="par-set-branch"
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
            <label htmlFor="par-set-item">{t('rq.column.item')}</label>
            <select
              id="par-set-item"
              required
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="">{t('rq.field.choose')}</option>
              {(items.data ?? [])
                .filter((i) => i.active)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {nameOf(i)} ({i.code})
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="par-set-quantity">{t('par.levels.quantity')}</label>
            <input
              id="par-set-quantity"
              inputMode="decimal"
              autoComplete="off"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="actions">
            <button type="submit" className="button" disabled={save.isPending}>
              {t('par.levels.save')}
            </button>
          </div>
        </form>
      )}
      {save.isError && <ErrorCallout error={save.error} messages={PAR_ERRORS} />}
      {remove.isError && <ErrorCallout error={remove.error} messages={PAR_ERRORS} />}
      {levels.isError && <ErrorCallout error={levels.error} />}
      {levels.data &&
        (levels.data.length === 0 ? (
          <p className="muted">{t('par.levels.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">{t('par.levels.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('rq.column.branch')}</th>
                  <th scope="col">{t('rq.column.item')}</th>
                  <th scope="col" className="numeric">
                    {t('rq.column.par')}
                  </th>
                  <th scope="col">{t('par.levels.updated')}</th>
                  {canManage && (
                    <th scope="col">
                      <span className="visually-hidden">{t('par.levels.actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {levels.data.map((level) => (
                  <tr key={`${level.location.id}:${level.item.id}`}>
                    <td data-label={t('rq.column.branch')}>{level.location.code}</td>
                    <td data-label={t('rq.column.item')}>
                      {nameOf(level.item)} <span className="subtle">({level.item.code})</span>
                    </td>
                    <td data-label={t('rq.column.par')} className="numeric">
                      {groupDigits(level.quantity)}{' '}
                      {unitName(units.data ?? [], level.item.baseUnitCode, language)}
                    </td>
                    <td data-label={t('par.levels.updated')}>
                      {level.updatedBy.displayName} · {formatDateTime(level.updatedAt, language)}
                    </td>
                    {canManage && (
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('par.levels.remove', {
                            item: level.item.code,
                            branch: level.location.code,
                          })}
                          disabled={remove.isPending}
                          onClick={() =>
                            remove.mutate({ locationId: level.location.id, itemId: level.item.id })
                          }
                        >
                          {t('par.levels.removeShort')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

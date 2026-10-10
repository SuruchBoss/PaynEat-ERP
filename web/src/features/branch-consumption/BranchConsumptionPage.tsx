// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listLocations } from '@/features/locations/locations.api';
import type { MessageKey } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import { formatBusinessDate, formatDateTime, groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  getConsumption,
  getUsage,
  listConsumptions,
  listProblems,
  reprocess,
  runProcessor,
  type PeriodQuery,
  type ProblemReason,
  type SalesEventProblem,
} from './branch-consumption.api';

const ERRORS: Record<string, MessageKey> = {
  SALES_EVENT_NOT_REPROCESSABLE: 'bc.error.notReprocessable',
  SALES_EVENT_PROCESSED: 'bc.error.processed',
  VALIDATION_FAILED: 'bc.error.period',
};

const REASONS: Record<ProblemReason, MessageKey> = {
  unknown_menu_item: 'bc.reason.unknown_menu_item',
  unknown_modifier: 'bc.reason.unknown_modifier',
  no_recipe_in_effect: 'bc.reason.no_recipe_in_effect',
  sold_by_mismatch: 'bc.reason.sold_by_mismatch',
  inactive_ingredient: 'bc.reason.inactive_ingredient',
  negative_usage: 'bc.reason.negative_usage',
  sale_time_ahead: 'bc.reason.sale_time_ahead',
};

const BLOCKS: Record<NonNullable<SalesEventProblem['notReprocessableBecause']>, MessageKey> = {
  sale_date_not_yet: 'bc.block.sale_date_not_yet',
  past_sale_without_recipe: 'bc.block.past_sale_without_recipe',
  not_fixable: 'bc.block.not_fixable',
};

/** Today on this device, as an ISO date: a starting value the person changes; the API checks it. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Branch consumption (#17, ADR-0030): what each POS sale took from its branch's lots, the sales a
 * person has to look at (failed for their master data, or held for a sale time too far ahead),
 * and the theoretical usage per day, branch and item, valued at the lots it came from. Estimated
 * costs and expired lots are always shown as such, never as facts.
 */
export function BranchConsumptionPage() {
  const { t, language } = useI18n();
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const branches = (locations.data ?? []).filter((l) => l.type === 'branch');
  const today = localToday();
  const [period, setPeriod] = useState<PeriodQuery>({ from: today, to: today, branchId: '' });
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <section className="page page--wide" aria-labelledby="bc-title">
      <div className="page__header">
        <div>
          <h1 id="bc-title">{t('bc.title')}</h1>
          <p className="muted">{t('bc.intro')}</p>
        </div>
      </div>
      <div className="filters">
        <div className="field">
          <label htmlFor="bc-from">{t('bc.from')}</label>
          <DateField
            id="bc-from"
            value={period.from}
            onChange={(from) => setPeriod({ ...period, from })}
            compact
          />
        </div>
        <div className="field">
          <label htmlFor="bc-to">{t('bc.to')}</label>
          <DateField
            id="bc-to"
            value={period.to}
            onChange={(to) => setPeriod({ ...period, to })}
            compact
          />
        </div>
        <div className="field">
          <label htmlFor="bc-branch">{t('bc.column.branch')}</label>
          <select
            id="bc-branch"
            value={period.branchId}
            onChange={(e) => setPeriod({ ...period, branchId: e.target.value })}
          >
            <option value="">{t('bc.allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {nameOf(b)} ({b.code})
              </option>
            ))}
          </select>
        </div>
      </div>
      <Problems branchId={period.branchId} />
      <Consumptions period={period} />
      <Usage period={period} />
    </section>
  );
}

function Problems({ branchId }: { branchId: string }) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const canReprocess = useAuthStore((s) => s.user?.permissions ?? []).includes(
    Permission.SALES_EVENT_REPROCESS,
  );
  const problems = useQuery({
    queryKey: qk.consumptionProblems(branchId),
    queryFn: () => listProblems(branchId),
  });
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.branchConsumption });
  const run = useMutation({
    mutationFn: runProcessor,
    onSuccess: async (result) => {
      setNotice(t('bc.run.done', { ...result }));
      await refresh();
    },
  });
  const retry = useMutation({
    mutationFn: (problem: SalesEventProblem) => reprocess(problem.salesEventId),
    onSuccess: async (result, problem) => {
      setNotice(
        result.problem
          ? t('bc.reprocess.stillFailing', {
              key: problem.idempotencyKey,
              reason: t(REASONS[result.problem.reason]),
            })
          : t('bc.reprocess.done', { key: problem.idempotencyKey }),
      );
      await refresh();
    },
  });

  return (
    <div className="panel" role="region" aria-labelledby="bc-problems-title">
      <h2 id="bc-problems-title">{t('bc.problems.title')}</h2>
      <p className="subtle">{t('bc.problems.hint')}</p>
      {canReprocess && (
        <div className="actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={run.isPending}
            onClick={() => {
              setNotice(null);
              run.mutate();
            }}
          >
            {run.isPending ? t('bc.run.running') : t('bc.run.now')}
          </button>
        </div>
      )}
      {notice && (
        <p className="callout callout--success" role="status">
          {notice}
        </p>
      )}
      {run.isError && <ErrorCallout error={run.error} messages={ERRORS} />}
      {retry.isError && <ErrorCallout error={retry.error} messages={ERRORS} />}
      {problems.isError && <ErrorCallout error={problems.error} messages={ERRORS} />}
      {problems.data &&
        (problems.data.length === 0 ? (
          <p className="muted">{t('bc.problems.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">{t('bc.problems.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('bc.column.sale')}</th>
                  <th scope="col">{t('bc.column.branch')}</th>
                  <th scope="col">{t('bc.column.menuItem')}</th>
                  <th scope="col">{t('bc.column.problem')}</th>
                  {canReprocess && <th scope="col">{t('bc.column.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {problems.data.map((p) => (
                  <tr key={p.salesEventId}>
                    <td data-label={t('bc.column.sale')}>
                      <span>
                        <span className="cell-title">{formatDateTime(p.saleTime, language)}</span>
                        <span className="subtle">
                          <code>{p.idempotencyKey}</code>
                        </span>
                      </span>
                    </td>
                    <td data-label={t('bc.column.branch')}>{p.branch.code}</td>
                    <td data-label={t('bc.column.menuItem')}>
                      <code>{p.menuItemCode}</code>{' '}
                      <span className="subtle">
                        {p.weightKg !== null
                          ? t('bc.soldWeight', { kg: groupDigits(p.weightKg) })
                          : t('bc.soldQuantity', { quantity: groupDigits(p.quantity ?? '0') })}
                      </span>
                    </td>
                    <td data-label={t('bc.column.problem')}>
                      <span>
                        <span
                          className={`badge badge--inline ${p.outcome === 'held' ? 'badge--neutral' : 'badge--down'}`}
                        >
                          {t(p.outcome === 'held' ? 'bc.outcome.held' : 'bc.outcome.failed')}
                        </span>{' '}
                        {t(REASONS[p.reason])}
                        {typeof p.detail?.code === 'string' && (
                          <span className="subtle">
                            {' '}
                            <code>{p.detail.code}</code>
                          </span>
                        )}
                        {p.notReprocessableBecause && (
                          <span className="subtle"> {t(BLOCKS[p.notReprocessableBecause])}</span>
                        )}
                      </span>
                    </td>
                    {canReprocess && (
                      <td data-label={t('bc.column.actions')}>
                        <button
                          type="button"
                          className="button button--small"
                          disabled={!p.reprocessable || retry.isPending}
                          aria-label={t('bc.reprocess.label', { key: p.idempotencyKey })}
                          onClick={() => {
                            setNotice(null);
                            retry.mutate(p);
                          }}
                        >
                          {t('bc.reprocess.short')}
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

function Flags({
  shortfall,
  expired,
  placeholder,
}: {
  shortfall: boolean;
  expired: boolean;
  placeholder: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      {shortfall && (
        <span className="badge badge--down badge--inline">{t('bc.flag.shortfall')}</span>
      )}
      {expired && <span className="badge badge--down badge--inline">{t('bc.flag.expired')}</span>}
      {placeholder && (
        <span className="badge badge--neutral badge--inline">{t('bc.flag.placeholder')}</span>
      )}
    </>
  );
}

function Consumptions({ period }: { period: PeriodQuery }) {
  const { t, language } = useI18n();
  const list = useQuery({
    queryKey: qk.consumptions(JSON.stringify(period)),
    queryFn: () => listConsumptions(period),
    enabled: Boolean(period.from && period.to),
  });
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="panel" role="region" aria-labelledby="bc-documents-title">
      <h2 id="bc-documents-title">{t('bc.documents.title')}</h2>
      <p className="subtle">{t('bc.documents.hint')}</p>
      {list.isError && <ErrorCallout error={list.error} messages={ERRORS} />}
      {list.data &&
        (list.data.length === 0 ? (
          <p className="muted">{t('bc.documents.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">{t('bc.documents.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('bc.column.document')}</th>
                  <th scope="col">{t('bc.column.sale')}</th>
                  <th scope="col">{t('bc.column.branch')}</th>
                  <th scope="col">{t('bc.column.menuItem')}</th>
                  <th scope="col">{t('bc.column.flags')}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((d) => (
                  <tr key={d.documentId}>
                    <td data-label={t('bc.column.document')}>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        aria-expanded={openId === d.documentId}
                        onClick={() => setOpenId(openId === d.documentId ? null : d.documentId)}
                      >
                        {d.number}
                      </button>
                    </td>
                    <td data-label={t('bc.column.sale')}>
                      <span>
                        <span className="cell-title">{formatDateTime(d.saleTime, language)}</span>
                        <span className="subtle">
                          <code>{d.idempotencyKey}</code>
                        </span>
                      </span>
                    </td>
                    <td data-label={t('bc.column.branch')}>{d.branch.code}</td>
                    <td data-label={t('bc.column.menuItem')}>
                      <code>{d.menuItemCode}</code>
                    </td>
                    <td data-label={t('bc.column.flags')}>
                      <Flags
                        shortfall={d.shortfall}
                        expired={d.consumedExpiredLot}
                        placeholder={d.placeholder}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {openId && <ConsumptionDetail documentId={openId} />}
    </div>
  );
}

function ConsumptionDetail({ documentId }: { documentId: string }) {
  const { t, language } = useI18n();
  const doc = useQuery({
    queryKey: qk.consumption(documentId),
    queryFn: () => getConsumption(documentId),
  });
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  if (doc.isError) return <ErrorCallout error={doc.error} messages={ERRORS} />;
  if (!doc.data) return null;
  const d = doc.data;
  return (
    <div className="panel panel--nested" role="region" aria-labelledby="bc-detail-title">
      <h3 id="bc-detail-title">
        {t('bc.detail.title', { number: d.number, menuItem: nameOf(d.menuItem) })}
      </h3>
      <p className="subtle">
        {t('bc.detail.meta', {
          branch: nameOf(d.branch),
          time: formatDateTime(d.saleTime, language),
          recipe: formatBusinessDate(d.recipeEffectiveFrom, language),
          key: d.salesEvent.idempotencyKey,
        })}
      </p>
      {d.postedBy && (
        <p className="subtle">
          {t('bc.detail.postedBy', {
            name: d.postedBy.displayName,
            time: d.postedAt ? formatDateTime(d.postedAt, language) : '',
          })}
        </p>
      )}
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">{t('bc.detail.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('bc.column.item')}</th>
              <th scope="col" className="numeric">
                {t('bc.column.usage')}
              </th>
              <th scope="col">{t('bc.column.lots')}</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((line) => (
              <tr key={line.lineNo}>
                <td data-label={t('bc.column.item')}>
                  {nameOf(line.item)} <span className="subtle">({line.item.code})</span>
                </td>
                <td data-label={t('bc.column.usage')} className="numeric">
                  {groupDigits(line.quantity)} {line.item.baseUnitCode}
                </td>
                <td data-label={t('bc.column.lots')}>
                  <ul className="plain-list">
                    {line.lots.map((lot) => (
                      <li key={lot.id}>
                        <code>{lot.number}</code>{' '}
                        {t('bc.detail.lot', {
                          quantity: groupDigits(lot.quantity),
                          cost: groupDigits(lot.unitCost),
                        })}
                        {lot.placeholderCost && (
                          <span className="badge badge--neutral badge--inline">
                            {t(
                              lot.placeholderCost === 'unknown'
                                ? 'bc.cost.unknown'
                                : 'bc.cost.estimated',
                            )}
                          </span>
                        )}
                        {lot.expired && (
                          <span className="badge badge--down badge--inline">
                            {t('bc.flag.expired')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Usage({ period }: { period: PeriodQuery }) {
  const { t, language } = useI18n();
  const usage = useQuery({
    queryKey: qk.consumptionUsage(JSON.stringify(period)),
    queryFn: () => getUsage(period),
    enabled: Boolean(period.from && period.to),
  });
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;

  return (
    <div className="panel" role="region" aria-labelledby="bc-usage-title">
      <h2 id="bc-usage-title">{t('bc.usage.title')}</h2>
      <p className="subtle">{t('bc.usage.hint')}</p>
      {usage.isError && <ErrorCallout error={usage.error} messages={ERRORS} />}
      {usage.data &&
        (usage.data.length === 0 ? (
          <p className="muted">{t('bc.usage.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">{t('bc.usage.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('bc.column.date')}</th>
                  <th scope="col">{t('bc.column.branch')}</th>
                  <th scope="col">{t('bc.column.item')}</th>
                  <th scope="col" className="numeric">
                    {t('bc.column.usage')}
                  </th>
                  <th scope="col" className="numeric">
                    {t('bc.column.value')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.data.map((row) => (
                  <tr key={`${row.date}:${row.branch.id}:${row.item.id}`}>
                    <td data-label={t('bc.column.date')}>
                      {formatBusinessDate(row.date, language)}
                    </td>
                    <td data-label={t('bc.column.branch')}>{row.branch.code}</td>
                    <td data-label={t('bc.column.item')}>
                      {nameOf(row.item)} <span className="subtle">({row.item.code})</span>
                    </td>
                    <td data-label={t('bc.column.usage')} className="numeric">
                      {groupDigits(row.quantity)} {row.item.baseUnitCode}
                    </td>
                    <td data-label={t('bc.column.value')} className="numeric">
                      <span>{groupDigits(row.value)}</span>
                      {row.unknownCost && (
                        <span className="badge badge--neutral badge--inline">
                          {t('bc.cost.unknown')}
                        </span>
                      )}
                      {row.estimatedCost && !row.unknownCost && (
                        <span className="badge badge--neutral badge--inline">
                          {t('bc.cost.estimated')}
                        </span>
                      )}
                      {row.consumedExpiredLot && (
                        <span className="badge badge--down badge--inline">
                          {t('bc.flag.expired')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query';
import { qk } from '@/app/query-client';
import type { Language, MessageKey } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { ApiError } from '@/lib/api-error';
import { fetchHealth, type HealthCheck } from './status.api';

type ComponentState = 'up' | 'down' | 'unknown';
type Overall = 'checking' | 'ok' | 'degraded' | 'unreachable';

interface StatusView {
  overall: Overall;
  api: ComponentState;
  database: ComponentState;
  /** Shown whenever something is wrong and the API gave us an id to quote. */
  correlationId?: string;
  errorKey?: MessageKey;
  errorStatus?: number;
}

/** Everything the screen shows, decided in one place from the query's outcome. */
function toView(data: HealthCheck | undefined, error: unknown): StatusView {
  if (error) {
    const apiError = error instanceof ApiError ? error : undefined;
    const errorKey: MessageKey =
      !apiError || apiError.isUnreachable
        ? 'status.error.unreachable'
        : apiError.code === 'INVALID_RESPONSE'
          ? 'status.error.invalid'
          : 'status.error.http';
    return {
      overall: 'unreachable',
      api: 'down',
      database: 'unknown',
      correlationId: apiError?.requestId,
      errorKey,
      errorStatus: apiError?.status,
    };
  }
  if (!data) return { overall: 'checking', api: 'unknown', database: 'unknown' };

  const { report, requestId } = data;
  const healthy = report.status === 'ok';
  return {
    overall: healthy ? 'ok' : 'degraded',
    api: report.api,
    database: report.database,
    correlationId: healthy ? undefined : requestId,
  };
}

const OVERALL_KEY: Record<Overall, MessageKey> = {
  checking: 'status.checking',
  ok: 'status.overall.ok',
  degraded: 'status.overall.degraded',
  unreachable: 'status.overall.unreachable',
};

const STATE_KEY: Record<ComponentState, MessageKey> = {
  up: 'status.state.up',
  down: 'status.state.down',
  unknown: 'status.state.unknown',
};

function formatTime(timestamp: number, language: Language): string {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp));
}

export function StatusPage() {
  const { t, language } = useI18n();
  const query = useQuery({
    queryKey: qk.health,
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });

  const view = toView(query.data, query.error);
  const checkedAt = Math.max(query.dataUpdatedAt, query.errorUpdatedAt);
  const components: { key: MessageKey; state: ComponentState }[] = [
    { key: 'status.component.api', state: view.api },
    { key: 'status.component.database', state: view.database },
  ];

  return (
    <section className="page" aria-labelledby="status-title">
      <div className="page__header">
        <div>
          <h1 id="status-title">{t('status.title')}</h1>
          <p className="muted">{t('status.intro')}</p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? t('status.checking') : t('status.refresh')}
        </button>
      </div>

      <p className={`overall overall--${view.overall}`} role="status">
        {t(OVERALL_KEY[view.overall])}
      </p>

      <table className="status-table">
        <caption className="visually-hidden">{t('status.components')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('status.column.component')}</th>
            <th scope="col">{t('status.column.state')}</th>
          </tr>
        </thead>
        <tbody>
          {components.map((component) => (
            <tr key={component.key}>
              <th scope="row">{t(component.key)}</th>
              <td>
                <span className={`badge badge--${component.state}`}>
                  {t(STATE_KEY[component.state])}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {checkedAt > 0 && (
        <p className="subtle">{t('status.checkedAt', { time: formatTime(checkedAt, language) })}</p>
      )}

      {(view.errorKey || view.correlationId) && (
        <div className="callout callout--danger" role="alert">
          {view.errorKey && <p>{t(view.errorKey, { status: view.errorStatus ?? '' })}</p>}
          {view.correlationId && (
            <>
              <p>
                {t('status.correlationId')}: <code>{view.correlationId}</code>
              </p>
              <p className="subtle">{t('status.correlationIdHint')}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

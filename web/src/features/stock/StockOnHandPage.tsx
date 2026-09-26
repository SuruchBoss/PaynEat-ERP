// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { qk } from '@/app/query-client';
import { ErrorCallout } from '@/components/ErrorCallout';
import { listItems, listUnits, unitName } from '@/features/items/items.api';
import { listLocations } from '@/features/locations/locations.api';
import type { MessageKey } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { formatBusinessDate, groupDigits } from '@/lib/format';
import { stockOnHand, type StockOnHandQuery } from './stock.api';

const ERRORS: Record<string, MessageKey> = {
  AS_OF_IN_FUTURE: 'stock.error.future',
  INVALID_DATE: 'stock.error.date',
  VALIDATION_FAILED: 'stock.error.date',
};

/**
 * Stock on hand (#7): per item, lot and location, as of the end of any business date, with
 * quantity, piece count, cost, value and expiry. Figures are the API's exact strings, grouped
 * in thousands and never recomputed here (ADR-0019).
 */
export function StockOnHandPage() {
  const { t, language } = useI18n();
  const [query, setQuery] = useState<StockOnHandQuery>({});
  const stock = useQuery({
    queryKey: qk.stockOnHand({ ...query } as Record<string, string>),
    queryFn: () => stockOnHand(query),
  });
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits });
  const unitList = units.data ?? [];
  const nameOf = (x: { nameTh: string; nameEn: string }) =>
    language === 'th' ? x.nameTh : x.nameEn;
  const set = (field: keyof StockOnHandQuery) => (value: string) =>
    setQuery((q) => ({ ...q, [field]: value || undefined }));

  return (
    <section className="page page--wide" aria-labelledby="stock-title">
      <div className="page__header">
        <div>
          <h1 id="stock-title">{t('stock.title')}</h1>
          <p className="muted">{t('stock.intro')}</p>
        </div>
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="stock-as-of">{t('stock.asOf')}</label>
          <input
            id="stock-as-of"
            type="date"
            aria-describedby="stock-as-of-hint"
            value={query.asOf ?? ''}
            onChange={(e) => set('asOf')(e.target.value)}
          />
          <p id="stock-as-of-hint" className="subtle">
            {t('stock.asOfHint')}
          </p>
        </div>
        <div className="field">
          <label htmlFor="stock-location">{t('stock.location')}</label>
          <select
            id="stock-location"
            value={query.locationId ?? ''}
            onChange={(e) => set('locationId')(e.target.value)}
          >
            <option value="">{t('stock.allLocations')}</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {nameOf(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="stock-item">{t('stock.item')}</label>
          <select
            id="stock-item"
            value={query.itemId ?? ''}
            onChange={(e) => set('itemId')(e.target.value)}
          >
            <option value="">{t('stock.allItems')}</option>
            {(items.data ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} · {nameOf(i)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {stock.isPending && (
        <p className="muted" role="status">
          {t('stock.loading')}
        </p>
      )}
      {stock.isError && <ErrorCallout error={stock.error} messages={ERRORS} />}

      {stock.data && (
        <>
          <p className="subtle" role="status">
            {t('stock.summary', {
              date: formatBusinessDate(stock.data.asOf, language),
              count: stock.data.rows.length,
              value: groupDigits(stock.data.totalValue),
            })}
          </p>
          {stock.data.rows.length === 0 ? (
            <p className="muted">{t('stock.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">
                  {t('stock.table.caption', {
                    date: formatBusinessDate(stock.data.asOf, language),
                  })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('stock.column.location')}</th>
                    <th scope="col">{t('stock.column.item')}</th>
                    <th scope="col">{t('stock.column.lot')}</th>
                    <th scope="col" className="numeric">
                      {t('stock.column.quantity')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('stock.column.pieces')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('stock.column.unitCost')}
                    </th>
                    <th scope="col" className="numeric">
                      {t('stock.column.value')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stock.data.rows.map((row) => {
                    const negative = row.quantity.startsWith('-');
                    return (
                      <tr key={`${row.lot.id}|${row.location.id}`}>
                        <td>
                          <span className="cell-title">{nameOf(row.location)}</span>
                          <span className="subtle">
                            <code>{row.location.code}</code>
                          </span>
                        </td>
                        <th scope="row">
                          <span className="cell-title">{nameOf(row.item)}</span>
                          <span className="subtle">
                            <code>{row.item.code}</code>
                          </span>
                        </th>
                        <td>
                          <code>{row.lot.number}</code>
                          <span className="subtle">
                            {t('stock.expires', {
                              date: formatBusinessDate(row.lot.expiryDate, language),
                            })}
                            {row.expired && (
                              <span className="badge badge--down badge--inline">
                                {t('stock.expired')}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="numeric nowrap">
                          {groupDigits(row.quantity)}{' '}
                          {unitName(unitList, row.item.baseUnitCode, language)}
                          {negative && (
                            <span className="badge badge--down badge--inline">
                              {t('stock.negative')}
                            </span>
                          )}
                        </td>
                        <td className="numeric nowrap">
                          {row.secondaryQuantity === null
                            ? t('stock.noPieces')
                            : t('stock.pieces', { count: groupDigits(row.secondaryQuantity) })}
                        </td>
                        <td className="numeric nowrap">{groupDigits(row.unitCost)}</td>
                        <td className="numeric nowrap">{groupDigits(row.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={6}>
                      {t('stock.total')}
                    </th>
                    <td className="numeric nowrap">
                      <strong>{groupDigits(stock.data.totalValue)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

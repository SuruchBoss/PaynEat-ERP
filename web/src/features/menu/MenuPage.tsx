// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import { ApiError } from '@/lib/api-error';
import { formatBusinessDate, groupDigits } from '@/lib/format';
import { listLocations } from '@/features/locations/locations.api';
import { useAuthStore } from '@/stores/auth.store';
import {
  createMenuItem,
  getMenuItem,
  listMenuItems,
  listModifierGroups,
  setMenuPrice,
  updateMenuItem,
  type MenuItemDetailView,
  type MenuItemView,
  type SoldBy,
} from './menu.api';
import { RecipeEditor } from './RecipeEditor';
import { TIMING } from './timing';

type StatusFilter = 'active' | 'inactive' | 'all';

/** Kept as a key, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const FILTERS: Record<StatusFilter, MessageKey> = {
  active: 'menu.filter.active',
  inactive: 'menu.filter.inactive',
  all: 'menu.filter.all',
};

const SOLD_BY: Record<SoldBy, MessageKey> = {
  portion: 'menu.soldBy.portion',
  weight: 'menu.soldBy.weight',
};

const SAVE_ERRORS: Record<string, MessageKey> = {
  MENU_ITEM_CODE_TAKEN: 'menu.error.codeTaken',
  MENU_ITEM_CHANGED: 'menu.error.changed',
  UNKNOWN_MODIFIER_GROUP: 'menu.error.unknownGroup',
  VALIDATION_FAILED: 'menu.error.invalid',
};

const PRICE_ERRORS: Record<string, MessageKey> = {
  INVALID_PRICE: 'menu.price.error.invalid',
  PRICE_IN_EFFECT: 'menu.price.error.inEffect',
  NOT_A_BRANCH: 'menu.price.error.notABranch',
  CHAIN_PRICE_REQUIRED: 'menu.price.error.chainRequired',
  INVALID_DATE: 'menu.price.error.date',
  VALIDATION_FAILED: 'menu.price.error.invalid',
};

/**
 * Menu items and their prices (#16): what branches sell, kept in the ERP and mirrored by every
 * connected POS. Readers see prices and recipes with their theoretical cost; only the admin
 * (`menu:manage`) sees the buttons that change them.
 */
export function MenuPage() {
  const { t } = useI18n();
  const canManage =
    useAuthStore((s) => s.user?.permissions.includes(Permission.MENU_MANAGE)) ?? false;
  const menu = useQuery({ queryKey: qk.menuItems, queryFn: listMenuItems });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (menu.data ?? []).filter(
      (item) =>
        (status === 'all' || item.active === (status === 'active')) &&
        (!needle ||
          [item.code, item.nameTh, item.nameEn, item.categoryTh, item.categoryEn].some((s) =>
            s.toLocaleLowerCase().includes(needle),
          )),
    );
  }, [menu.data, search, status]);

  return (
    <section className="page page--wide" aria-labelledby="menu-title">
      <div className="page__header">
        <div>
          <h1 id="menu-title">{t('menu.title')}</h1>
          <p className="muted">{t('menu.intro')}</p>
        </div>
        {canManage && !creating && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setOpenId(null);
              setNotice(null);
            }}
          >
            {t('menu.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}
        </p>
      )}

      {creating && (
        <MenuItemForm
          onClose={() => setCreating(false)}
          onSaved={(item) => {
            setCreating(false);
            setOpenId(item.id);
            setNotice({ key: 'menu.create.done', params: { code: item.code } });
          }}
        />
      )}
      {openId && (
        <MenuItemPanel
          key={openId}
          id={openId}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      <div className="filters">
        <div className="field">
          <label htmlFor="menu-search">{t('menu.search')}</label>
          <input
            id="menu-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="menu-status">{t('menu.filter')}</label>
          <select
            id="menu-status"
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

      {menu.isPending && (
        <p className="muted" role="status">
          {t('menu.loading')}
        </p>
      )}
      {menu.isError && <ErrorCallout error={menu.error} />}

      {menu.data && (
        <>
          <p className="subtle" role="status">
            {t('menu.count', { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <p className="muted">{t('menu.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('menu.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('menu.column.item')}</th>
                    <th scope="col">{t('menu.column.category')}</th>
                    <th scope="col" className="numeric">
                      {t('menu.column.price')}
                    </th>
                    <th scope="col">{t('menu.column.modifiers')}</th>
                    <th scope="col">{t('menu.column.status')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('menu.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((item) => (
                    <MenuRow
                      key={item.id}
                      item={item}
                      open={openId === item.id}
                      onOpen={() => {
                        setOpenId(openId === item.id ? null : item.id);
                        setCreating(false);
                        setNotice(null);
                      }}
                    />
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

function MenuRow({
  item,
  open,
  onOpen,
}: {
  item: MenuItemView;
  open: boolean;
  onOpen: () => void;
}) {
  const { t, language } = useI18n();
  const name = language === 'th' ? item.nameTh : item.nameEn;
  const otherName = language === 'th' ? item.nameEn : item.nameTh;
  return (
    <tr className={item.active ? undefined : 'row--off'}>
      <th scope="row">
        <span className="cell-title">{name}</span>
        <span className="subtle">
          <code>{item.code}</code> {otherName}
        </span>
      </th>
      <td data-label={t('menu.column.category')}>
        {language === 'th' ? item.categoryTh : item.categoryEn}
        {item.soldBy === 'weight' && (
          <span className="badge badge--neutral badge--inline">{t('menu.soldBy.weight')}</span>
        )}
      </td>
      <td className="numeric" data-label={t('menu.column.price')}>
        {item.currentPrice === null ? (
          <span className="subtle">{t('menu.noPrice')}</span>
        ) : (
          t(item.soldBy === 'weight' ? 'menu.pricePerKg' : 'menu.priceEach', {
            price: groupDigits(item.currentPrice),
          })
        )}
      </td>
      <td data-label={t('menu.column.modifiers')}>
        {item.modifierGroups.length === 0 ? (
          <span className="subtle">{t('menu.noModifiers')}</span>
        ) : (
          item.modifierGroups.map((g) => (language === 'th' ? g.nameTh : g.nameEn)).join(', ')
        )}
      </td>
      <td data-label={t('menu.column.status')}>
        <span className={`badge badge--${item.active ? 'up' : 'neutral'}`}>
          {t(item.active ? 'menu.status.active' : 'menu.status.inactive')}
        </span>
      </td>
      <td>
        <button
          type="button"
          className="button button--ghost button--small"
          aria-label={t('menu.open.label', { name })}
          aria-expanded={open}
          onClick={onOpen}
        >
          {t('menu.open.short')}
        </button>
      </td>
    </tr>
  );
}

/** One menu item: its prices, its recipe and, for the admin, the forms that change them. */
function MenuItemPanel({
  id,
  canManage,
  onClose,
  onNotice,
}: {
  id: string;
  canManage: boolean;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detail = useQuery({ queryKey: qk.menuItem(id), queryFn: () => getMenuItem(id) });
  const [editing, setEditing] = useState(false);

  useEffect(() => headingRef.current?.focus(), []);

  if (detail.isPending) {
    return (
      <p className="muted" role="status">
        {t('menu.loading')}
      </p>
    );
  }
  if (detail.isError) return <ErrorCallout error={detail.error} />;

  const item = detail.data;
  const name = language === 'th' ? item.nameTh : item.nameEn;

  return (
    <section className="panel" aria-labelledby="menu-item-title">
      <h2 id="menu-item-title" ref={headingRef} tabIndex={-1}>
        {name} <code>{item.code}</code>
      </h2>
      <p className="subtle">
        {t(SOLD_BY[item.soldBy])} · {language === 'th' ? item.categoryTh : item.categoryEn}
      </p>
      {editing ? (
        <MenuItemForm
          item={item}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            onNotice({ key: 'menu.edit.done', params: { code: saved.code } });
          }}
        />
      ) : (
        <div className="actions">
          {canManage && (
            <button type="button" className="button button--ghost" onClick={() => setEditing(true)}>
              {t('menu.edit.open')}
            </button>
          )}
          <button type="button" className="button button--ghost" onClick={onClose}>
            {t('menu.close')}
          </button>
        </div>
      )}

      <Prices item={item} canManage={canManage} />
      <RecipeEditor kind="menu" subjectId={item.id} canManage={canManage} />
    </section>
  );
}

function Prices({ item, canManage }: { item: MenuItemDetailView; canManage: boolean }) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const formId = useId();
  const locations = useQuery({
    queryKey: qk.locations,
    queryFn: listLocations,
    enabled: canManage,
  });
  const [scope, setScope] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [price, setPrice] = useState('');
  // A branch can end its own price and charge the chain-wide price again (ADR-0023).
  const [backToChain, setBackToChain] = useState(false);
  const returning = backToChain && scope !== '';

  const save = useMutation({
    mutationFn: () =>
      setMenuPrice(item.id, {
        locationId: scope || null,
        effectiveFrom,
        price: returning ? null : price.trim(),
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(qk.menuItem(item.id), saved);
      await queryClient.invalidateQueries({ queryKey: qk.menuItems, exact: true });
      setPrice('');
      setEffectiveFrom('');
      setBackToChain(false);
    },
  });

  const branches = (locations.data ?? []).filter((l) => l.type === 'branch' && l.active);
  const unit = item.soldBy === 'weight' ? 'menu.pricePerKg' : 'menu.priceEach';
  const describe = (error: ApiError) => {
    if (error.code !== 'EFFECTIVE_FROM_IN_PAST') return undefined;
    const earliest = (error.details as { earliest?: string } | undefined)?.earliest ?? '';
    return {
      key: 'menu.price.error.past' as MessageKey,
      params: { date: formatBusinessDate(earliest, language) },
    };
  };

  return (
    <section aria-labelledby={`${formId}-title`}>
      <h3 id={`${formId}-title`}>{t('menu.prices.title')}</h3>
      <p className="subtle">{t('menu.prices.hint')}</p>
      {item.prices.length === 0 ? (
        <p className="muted">{t('menu.prices.none')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">{t('menu.prices.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('menu.prices.column.scope')}</th>
                <th scope="col">{t('menu.prices.column.from')}</th>
                <th scope="col" className="numeric">
                  {t('menu.prices.column.price')}
                </th>
                <th scope="col">{t('menu.prices.column.status')}</th>
              </tr>
            </thead>
            <tbody>
              {item.prices.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    {p.location
                      ? `${p.location.code} · ${language === 'th' ? p.location.nameTh : p.location.nameEn}`
                      : t('menu.prices.chainWide')}
                  </th>
                  <td data-label={t('menu.prices.column.from')}>
                    {formatBusinessDate(p.effectiveFrom, language)}
                  </td>
                  <td className="numeric" data-label={t('menu.prices.column.price')}>
                    {p.price === null
                      ? t('menu.prices.backToChain')
                      : t(unit, { price: groupDigits(p.price) })}
                  </td>
                  <td data-label={t('menu.prices.column.status')}>
                    <span className={`badge badge--${TIMING[p.status].tone}`}>
                      {t(TIMING[p.status].key)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <form
          className="recipe-form"
          aria-labelledby={`${formId}-form`}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <h4 id={`${formId}-form`}>{t('menu.price.title')}</h4>
          <div className="field-grid">
            <div className="field">
              <label htmlFor={`${formId}-scope`}>{t('menu.price.scope')}</label>
              <select
                id={`${formId}-scope`}
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  if (e.target.value === '') setBackToChain(false);
                }}
              >
                <option value="">{t('menu.prices.chainWide')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {language === 'th' ? b.nameTh : b.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-from`}>{t('menu.price.from')}</label>
              <DateField
                id={`${formId}-from`}
                required
                describedBy={`${formId}-from-hint`}
                value={effectiveFrom}
                onChange={setEffectiveFrom}
              />
              <p id={`${formId}-from-hint`} className="subtle">
                {t('menu.price.fromHint')}
              </p>
            </div>
            {!returning && (
              <div className="field">
                <label htmlFor={`${formId}-price`}>
                  {t(item.soldBy === 'weight' ? 'menu.price.amountPerKg' : 'menu.price.amount')}
                </label>
                <input
                  id={`${formId}-price`}
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            )}
          </div>
          {scope !== '' && (
            <>
              <div className="check-field">
                <input
                  id={`${formId}-back`}
                  type="checkbox"
                  checked={backToChain}
                  aria-describedby={`${formId}-back-hint`}
                  onChange={(e) => setBackToChain(e.target.checked)}
                />
                <label htmlFor={`${formId}-back`}>{t('menu.price.backToChain')}</label>
              </div>
              <p id={`${formId}-back-hint`} className="subtle">
                {t('menu.price.backToChainHint')}
              </p>
            </>
          )}
          {save.isError && (
            <ErrorCallout error={save.error} messages={PRICE_ERRORS} describe={describe} />
          )}
          <div className="actions">
            <button type="submit" className="button" disabled={save.isPending}>
              {save.isPending ? t('menu.price.saving') : t('menu.price.save')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function MenuItemForm({
  item,
  onClose,
  onSaved,
}: {
  /** The menu item being edited; absent when creating one. */
  item?: MenuItemDetailView;
  onClose: () => void;
  onSaved: (item: MenuItemDetailView) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const groups = useQuery({ queryKey: qk.modifierGroups, queryFn: listModifierGroups });
  const [code, setCode] = useState(item?.code ?? '');
  const [nameTh, setNameTh] = useState(item?.nameTh ?? '');
  const [nameEn, setNameEn] = useState(item?.nameEn ?? '');
  const [categoryTh, setCategoryTh] = useState(item?.categoryTh ?? '');
  const [categoryEn, setCategoryEn] = useState(item?.categoryEn ?? '');
  const [soldBy, setSoldBy] = useState<SoldBy>(item?.soldBy ?? 'portion');
  const [groupIds, setGroupIds] = useState<string[]>(item?.modifierGroups.map((g) => g.id) ?? []);
  const [active, setActive] = useState(item?.active ?? true);

  useEffect(() => headingRef.current?.focus(), []);

  const save = useMutation({
    mutationFn: () => {
      const fields = { nameTh, nameEn, categoryTh, categoryEn, modifierGroupIds: groupIds };
      return item
        ? updateMenuItem(item.id, { ...fields, active, version: item.version })
        : createMenuItem({ ...fields, code, soldBy });
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(qk.menuItem(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: qk.menuItems, exact: true });
      onSaved(saved);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'MENU_ITEM_CHANGED' && item) {
        void queryClient.invalidateQueries({ queryKey: qk.menuItem(item.id) });
      }
    },
  });

  const choosable = (groups.data ?? []).filter((g) => g.active || groupIds.includes(g.id));
  const titleId = item ? 'menu-edit-title' : 'menu-new-title';

  return (
    <form
      className="panel"
      aria-labelledby={titleId}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {item ? t('menu.edit.title', { code: item.code }) : t('menu.create.title')}
      </h2>
      {!item && (
        <div className="field">
          <label htmlFor="menu-code">{t('menu.field.code')}</label>
          <input
            id="menu-code"
            required
            autoComplete="off"
            aria-describedby="menu-code-hint"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <p id="menu-code-hint" className="subtle">
            {t('menu.field.codeHint')}
          </p>
        </div>
      )}
      <div className="field-grid">
        <div className="field">
          <label htmlFor="menu-name-th">{t('menu.field.nameTh')}</label>
          <input
            id="menu-name-th"
            required
            value={nameTh}
            onChange={(e) => setNameTh(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="menu-name-en">{t('menu.field.nameEn')}</label>
          <input
            id="menu-name-en"
            required
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="menu-category-th">{t('menu.field.categoryTh')}</label>
          <input
            id="menu-category-th"
            required
            value={categoryTh}
            onChange={(e) => setCategoryTh(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="menu-category-en">{t('menu.field.categoryEn')}</label>
          <input
            id="menu-category-en"
            required
            value={categoryEn}
            onChange={(e) => setCategoryEn(e.target.value)}
          />
        </div>
      </div>
      {!item && (
        <fieldset className="document-lines">
          <legend>{t('menu.field.soldBy')}</legend>
          {(Object.keys(SOLD_BY) as SoldBy[]).map((value) => (
            <div key={value} className="check-field">
              <input
                id={`menu-sold-by-${value}`}
                type="radio"
                name="menu-sold-by"
                checked={soldBy === value}
                onChange={() => setSoldBy(value)}
              />
              <label htmlFor={`menu-sold-by-${value}`}>{t(SOLD_BY[value])}</label>
            </div>
          ))}
          <p className="subtle">{t('menu.field.soldByHint')}</p>
        </fieldset>
      )}
      <fieldset className="document-lines">
        <legend>{t('menu.field.modifierGroups')}</legend>
        {choosable.length === 0 && <p className="subtle">{t('menu.field.noGroups')}</p>}
        {choosable.map((group) => (
          <div key={group.id} className="check-field">
            <input
              id={`menu-group-${group.id}`}
              type="checkbox"
              checked={groupIds.includes(group.id)}
              onChange={(e) =>
                setGroupIds((ids) =>
                  e.target.checked ? [...ids, group.id] : ids.filter((x) => x !== group.id),
                )
              }
            />
            <label htmlFor={`menu-group-${group.id}`}>
              {language === 'th' ? group.nameTh : group.nameEn} <code>{group.code}</code>
            </label>
          </div>
        ))}
      </fieldset>
      {item && (
        <div className="check-field">
          <input
            id="menu-active"
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <label htmlFor="menu-active">{t('menu.field.active')}</label>
        </div>
      )}
      {save.isError && <ErrorCallout error={save.error} messages={SAVE_ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? t('menu.saving') : t(item ? 'menu.edit.save' : 'menu.create.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('menu.cancel')}
        </button>
      </div>
    </form>
  );
}

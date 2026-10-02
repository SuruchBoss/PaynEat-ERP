// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { ErrorCallout } from '@/components/ErrorCallout';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission } from '@/lib/access';
import { ApiError } from '@/lib/api-error';
import { groupDigits } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  createModifierGroup,
  listModifierGroups,
  updateModifierGroup,
  type ModifierGroupView,
  type ModifierOptionInput,
  type ModifierOptionView,
} from './menu.api';
import { RecipeEditor } from './RecipeEditor';

interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const SAVE_ERRORS: Record<string, MessageKey> = {
  MODIFIER_GROUP_CODE_TAKEN: 'modifiers.error.codeTaken',
  MODIFIER_CODE_TAKEN: 'modifiers.error.optionCodeTaken',
  MODIFIER_GROUP_CHANGED: 'modifiers.error.changed',
  MODIFIER_OPTION_REMOVED: 'modifiers.error.optionRemoved',
  DUPLICATE_MODIFIER_OPTION: 'modifiers.error.duplicateOption',
  INVALID_SELECTIONS: 'modifiers.error.selections',
  INVALID_PRICE: 'modifiers.error.price',
  VALIDATION_FAILED: 'modifiers.error.invalid',
};

/** A price change as people read it: "+10", "0", "−2.5". */
function signed(priceChange: string): string {
  if (priceChange.startsWith('-')) return `−${groupDigits(priceChange.slice(1))}`;
  return priceChange === '0' ? '0' : `+${groupDigits(priceChange)}`;
}

/**
 * Modifier groups and their options (#16): the choices a menu item offers, each option with a
 * price change and its own versioned recipe. Options are deactivated, never removed, because
 * sales carry their codes.
 */
export function ModifierGroupsPage() {
  const { t, language } = useI18n();
  const canManage =
    useAuthStore((s) => s.user?.permissions.includes(Permission.MENU_MANAGE)) ?? false;
  const groups = useQuery({ queryKey: qk.modifierGroups, queryFn: listModifierGroups });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recipeOf, setRecipeOf] = useState<ModifierOptionView | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const editing = groups.data?.find((g) => g.id === editingId) ?? null;
  const name = (x: { nameTh: string; nameEn: string }) => (language === 'th' ? x.nameTh : x.nameEn);

  return (
    <section className="page page--wide" aria-labelledby="modifiers-title">
      <div className="page__header">
        <div>
          <h1 id="modifiers-title">{t('modifiers.title')}</h1>
          <p className="muted">{t('modifiers.intro')}</p>
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
            {t('modifiers.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}
        </p>
      )}
      {creating && (
        <GroupForm
          onClose={() => setCreating(false)}
          onSaved={(group) => {
            setCreating(false);
            setNotice({ key: 'modifiers.create.done', params: { code: group.code } });
          }}
        />
      )}
      {canManage && editing && (
        <GroupForm
          key={editing.id}
          group={editing}
          onClose={() => setEditingId(null)}
          onSaved={(group) => {
            setEditingId(null);
            setNotice({ key: 'modifiers.edit.done', params: { code: group.code } });
          }}
        />
      )}
      {recipeOf && (
        <section className="panel" aria-labelledby="modifier-recipe-title">
          <h2 id="modifier-recipe-title">
            {t('modifiers.recipe.panel', { name: name(recipeOf) })}
          </h2>
          <RecipeEditor
            key={recipeOf.id}
            kind="modifier"
            subjectId={recipeOf.id}
            canManage={canManage}
          />
          <div className="actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setRecipeOf(null)}
            >
              {t('modifiers.recipe.close')}
            </button>
          </div>
        </section>
      )}

      {groups.isPending && (
        <p className="muted" role="status">
          {t('modifiers.loading')}
        </p>
      )}
      {groups.isError && <ErrorCallout error={groups.error} />}
      {groups.data &&
        (groups.data.length === 0 ? (
          <p className="muted">{t('modifiers.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">{t('modifiers.table.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('modifiers.column.group')}</th>
                  <th scope="col">{t('modifiers.column.selections')}</th>
                  <th scope="col">{t('modifiers.column.options')}</th>
                  <th scope="col">{t('modifiers.column.status')}</th>
                  {canManage && (
                    <th scope="col">
                      <span className="visually-hidden">{t('modifiers.column.actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {groups.data.map((group) => (
                  <tr key={group.id} className={group.active ? undefined : 'row--off'}>
                    <th scope="row">
                      <span className="cell-title">{name(group)}</span>
                      <span className="subtle">
                        <code>{group.code}</code>
                      </span>
                    </th>
                    <td data-label={t('modifiers.column.selections')}>
                      {t('modifiers.selections', {
                        min: group.minSelections,
                        max: group.maxSelections,
                      })}
                    </td>
                    <td data-label={t('modifiers.column.options')}>
                      <ul className="plain-list">
                        {group.options.map((option) => (
                          <li key={option.id} className={option.active ? undefined : 'subtle'}>
                            {name(option)} <code>{option.code}</code>{' '}
                            {t('modifiers.priceChange', { change: signed(option.priceChange) })}
                            {!option.active && ` · ${t('modifiers.status.inactive')}`}{' '}
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              aria-label={t('modifiers.recipe.open', { name: name(option) })}
                              onClick={() => {
                                setRecipeOf(option);
                                setNotice(null);
                              }}
                            >
                              {t('modifiers.recipe.short')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td data-label={t('modifiers.column.status')}>
                      <span className={`badge badge--${group.active ? 'up' : 'neutral'}`}>
                        {t(group.active ? 'modifiers.status.active' : 'modifiers.status.inactive')}
                      </span>
                    </td>
                    {canManage && (
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          aria-label={t('modifiers.edit.label', { name: name(group) })}
                          aria-expanded={editingId === group.id}
                          onClick={() => {
                            setEditingId(editingId === group.id ? null : group.id);
                            setCreating(false);
                            setNotice(null);
                          }}
                        >
                          {t('modifiers.edit.short')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

interface OptionRow extends ModifierOptionInput {
  key: number;
  /** Saved before: its code is fixed and it can only be deactivated. */
  saved: boolean;
}

function GroupForm({
  group,
  onClose,
  onSaved,
}: {
  group?: ModifierGroupView;
  onClose: () => void;
  onSaved: (group: ModifierGroupView) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nextKey = useRef(0);
  const [code, setCode] = useState(group?.code ?? '');
  const [nameTh, setNameTh] = useState(group?.nameTh ?? '');
  const [nameEn, setNameEn] = useState(group?.nameEn ?? '');
  const [minSelections, setMinSelections] = useState(String(group?.minSelections ?? 0));
  const [maxSelections, setMaxSelections] = useState(String(group?.maxSelections ?? 1));
  const [active, setActive] = useState(group?.active ?? true);
  const [rows, setRows] = useState<OptionRow[]>(() =>
    group
      ? group.options.map(({ id: _id, ...o }) => ({ ...o, key: nextKey.current++, saved: true }))
      : [
          {
            code: '',
            nameTh: '',
            nameEn: '',
            priceChange: '0',
            active: true,
            key: nextKey.current++,
            saved: false,
          },
        ],
  );

  useEffect(() => headingRef.current?.focus(), []);

  const save = useMutation({
    mutationFn: () => {
      const options = rows.map(({ key: _key, saved: _saved, ...o }) => ({
        ...o,
        priceChange: o.priceChange.trim(),
      }));
      const fields = {
        nameTh,
        nameEn,
        minSelections: Number(minSelections),
        maxSelections: Number(maxSelections),
        options,
      };
      return group
        ? updateModifierGroup(group.id, { ...fields, active, version: group.version })
        : createModifierGroup({ ...fields, code });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: qk.modifierGroups });
      onSaved(saved);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'MODIFIER_GROUP_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: qk.modifierGroups });
      }
    },
  });

  const setRow = (key: number, change: Partial<ModifierOptionInput>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const titleId = group ? 'modifier-edit-title' : 'modifier-new-title';

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
        {group ? t('modifiers.edit.title', { code: group.code }) : t('modifiers.create.title')}
      </h2>
      {!group && (
        <div className="field">
          <label htmlFor="modifier-code">{t('modifiers.field.code')}</label>
          <input
            id="modifier-code"
            required
            autoComplete="off"
            aria-describedby="modifier-code-hint"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <p id="modifier-code-hint" className="subtle">
            {t('modifiers.field.codeHint')}
          </p>
        </div>
      )}
      <div className="field-grid">
        <div className="field">
          <label htmlFor="modifier-name-th">{t('modifiers.field.nameTh')}</label>
          <input
            id="modifier-name-th"
            required
            value={nameTh}
            onChange={(e) => setNameTh(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="modifier-name-en">{t('modifiers.field.nameEn')}</label>
          <input
            id="modifier-name-en"
            required
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="modifier-min">{t('modifiers.field.min')}</label>
          <input
            id="modifier-min"
            required
            inputMode="numeric"
            value={minSelections}
            onChange={(e) => setMinSelections(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="modifier-max">{t('modifiers.field.max')}</label>
          <input
            id="modifier-max"
            required
            inputMode="numeric"
            value={maxSelections}
            onChange={(e) => setMaxSelections(e.target.value)}
          />
        </div>
      </div>
      <fieldset className="document-lines option-rows">
        <legend>{t('modifiers.options.legend')}</legend>
        <p className="subtle">{t('modifiers.options.hint')}</p>
        {rows.map((row, index) => {
          const n = index + 1;
          return (
            <div key={row.key} className="document-line">
              <div className="field">
                <label htmlFor={`option-code-${row.key}`}>
                  {t('modifiers.option.code', { n })}
                </label>
                <input
                  id={`option-code-${row.key}`}
                  required
                  autoComplete="off"
                  readOnly={row.saved}
                  value={row.code}
                  onChange={(e) => setRow(row.key, { code: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="field">
                <label htmlFor={`option-name-th-${row.key}`}>
                  {t('modifiers.option.nameTh', { n })}
                </label>
                <input
                  id={`option-name-th-${row.key}`}
                  required
                  value={row.nameTh}
                  onChange={(e) => setRow(row.key, { nameTh: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`option-name-en-${row.key}`}>
                  {t('modifiers.option.nameEn', { n })}
                </label>
                <input
                  id={`option-name-en-${row.key}`}
                  required
                  value={row.nameEn}
                  onChange={(e) => setRow(row.key, { nameEn: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`option-price-${row.key}`}>
                  {t('modifiers.option.priceChange', { n })}
                </label>
                <input
                  id={`option-price-${row.key}`}
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  value={row.priceChange}
                  onChange={(e) => setRow(row.key, { priceChange: e.target.value })}
                />
              </div>
              {row.saved ? (
                <div className="check-field">
                  <input
                    id={`option-active-${row.key}`}
                    type="checkbox"
                    checked={row.active}
                    onChange={(e) => setRow(row.key, { active: e.target.checked })}
                  />
                  <label htmlFor={`option-active-${row.key}`}>
                    {t('modifiers.option.active', { n })}
                  </label>
                </div>
              ) : (
                <button
                  type="button"
                  className="button button--ghost button--small"
                  aria-label={t('modifiers.option.removeLabel', { n })}
                  disabled={rows.length === 1}
                  onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
                >
                  {t('modifiers.option.remove')}
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() =>
            setRows((all) => [
              ...all,
              {
                code: '',
                nameTh: '',
                nameEn: '',
                priceChange: '0',
                active: true,
                key: nextKey.current++,
                saved: false,
              },
            ])
          }
        >
          {t('modifiers.option.add')}
        </button>
      </fieldset>
      {group && (
        <div className="check-field">
          <input
            id="modifier-active"
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <label htmlFor="modifier-active">{t('modifiers.field.active')}</label>
        </div>
      )}
      {save.isError && <ErrorCallout error={save.error} messages={SAVE_ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending
            ? t('modifiers.saving')
            : t(group ? 'modifiers.edit.save' : 'modifiers.create.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('modifiers.cancel')}
        </button>
      </div>
    </form>
  );
}

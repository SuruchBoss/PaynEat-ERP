// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { DateField } from '@/components/DateField';
import { ErrorCallout } from '@/components/ErrorCallout';
import type { MessageKey, MessageParams } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { ApiError } from '@/lib/api-error';
import { formatBusinessDate, groupDigits } from '@/lib/format';
import { listItems, listUnits, unitName, type ItemView } from '@/features/items/items.api';
import { TIMING } from './timing';
import {
  addRecipeVersion,
  getRecipe,
  replaceRecipeLines,
  type RecipeKind,
  type RecipeLineInput,
  type RecipeLineIssue,
  type RecipeVersionView,
  type RecipeView,
} from './menu.api';

const PER: Record<RecipeView['subject']['per'], MessageKey> = {
  portion: 'recipe.per.portion',
  kg: 'recipe.per.kg',
  unit_sold: 'recipe.per.unitSold',
};

const SAVE_ERRORS: Record<string, MessageKey> = {
  RECIPE_VERSION_OVERLAP: 'recipe.error.overlap',
  RECIPE_VERSION_IN_EFFECT: 'recipe.error.inEffect',
  INVALID_DATE: 'recipe.error.date',
  VALIDATION_FAILED: 'recipe.error.invalid',
};

const LINE_PROBLEMS: Record<string, MessageKey> = {
  unknown_item: 'recipe.problem.unknown_item',
  inactive_item: 'recipe.problem.inactive_item',
  duplicate_item: 'recipe.problem.duplicate_item',
  not_a_decimal: 'recipe.problem.not_a_decimal',
  not_positive: 'recipe.problem.not_positive',
  zero: 'recipe.problem.zero',
  too_many_decimals: 'recipe.problem.too_many_decimals',
  too_large: 'recipe.problem.too_large',
};

function describeError(
  error: ApiError,
  language: 'th' | 'en',
): { key: MessageKey; params?: MessageParams } | undefined {
  if (error.code === 'RECIPE_TOO_EARLY') {
    const earliest = (error.details as { earliest?: string } | undefined)?.earliest ?? '';
    return {
      key: 'recipe.error.tooEarly',
      params: { date: formatBusinessDate(earliest, language) },
    };
  }
  if (error.code === 'INVALID_RECIPE_LINES') return { key: 'recipe.error.lines' };
  return undefined;
}

function lineIssues(error: unknown): RecipeLineIssue[] {
  if (!(error instanceof ApiError) || error.code !== 'INVALID_RECIPE_LINES') return [];
  return (error.details as { issues?: RecipeLineIssue[] } | undefined)?.issues ?? [];
}

/**
 * A menu item's or a modifier option's recipe (#16): every version, newest first, each priced at
 * current lot costs, an estimate and labelled as one (ADR-0023). Whoever manages the menu adds a
 * version from a date, or corrects one that has not started; a version in force never changes.
 */
export function RecipeEditor({
  kind,
  subjectId,
  canManage,
}: {
  kind: RecipeKind;
  subjectId: string;
  canManage: boolean;
}) {
  const { t, language } = useI18n();
  const recipe = useQuery({
    queryKey: qk.recipe(kind, subjectId),
    queryFn: () => getRecipe(kind, subjectId),
  });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const titleId = useId();

  if (recipe.isPending) {
    return (
      <p className="muted" role="status">
        {t('recipe.loading')}
      </p>
    );
  }
  if (recipe.isError) return <ErrorCallout error={recipe.error} />;

  const { subject, versions } = recipe.data;
  const unitList = units.data ?? [];
  const name = language === 'th' ? subject.nameTh : subject.nameEn;

  return (
    <section className="recipe" aria-labelledby={titleId}>
      <div className="recipe__header">
        <h3 id={titleId}>{t('recipe.title', { name })}</h3>
        <p className="subtle">{t(PER[subject.per])}</p>
      </div>
      <p className="subtle">{t('recipe.costNote')}</p>

      {versions.length === 0 && <p className="muted">{t('recipe.none')}</p>}
      {versions.map((version) =>
        correcting === version.id ? (
          <LinesForm
            key={version.id}
            kind={kind}
            subjectId={subjectId}
            title={t('recipe.correct.title', { number: version.number })}
            correcting={version}
            onClose={() => setCorrecting(null)}
          />
        ) : (
          <VersionCard
            key={version.id}
            version={version}
            unitName={(code) => unitName(unitList, code, language)}
            onCorrect={
              canManage && version.status === 'scheduled'
                ? () => {
                    setCorrecting(version.id);
                    setAdding(false);
                  }
                : undefined
            }
          />
        ),
      )}

      {canManage &&
        (adding ? (
          <LinesForm
            kind={kind}
            subjectId={subjectId}
            title={t('recipe.add.title')}
            onClose={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setAdding(true);
              setCorrecting(null);
            }}
          >
            {t('recipe.add.open')}
          </button>
        ))}
    </section>
  );
}

function VersionCard({
  version,
  unitName,
  onCorrect,
}: {
  version: RecipeVersionView;
  unitName: (code: string) => string;
  onCorrect?: () => void;
}) {
  const { t, language } = useI18n();
  const timing = TIMING[version.status];
  const headingId = useId();
  return (
    <article className="recipe-version" aria-labelledby={headingId}>
      <h4 id={headingId}>
        {t('recipe.version.title', {
          number: version.number,
          date: formatBusinessDate(version.effectiveFrom, language),
        })}{' '}
        <span className={`badge badge--${timing.tone}`}>{t(timing.key)}</span>
      </h4>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">
            {t('recipe.version.caption', { number: version.number })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('recipe.column.item')}</th>
              <th scope="col" className="numeric">
                {t('recipe.column.quantity')}
              </th>
              <th scope="col" className="numeric">
                {t('recipe.column.unitCost')}
              </th>
              <th scope="col" className="numeric">
                {t('recipe.column.cost')}
              </th>
            </tr>
          </thead>
          <tbody>
            {version.lines.map((line) => (
              <tr key={line.lineNo}>
                <th scope="row">
                  <span className="cell-title">
                    {language === 'th' ? line.item.nameTh : line.item.nameEn}
                  </span>
                  <span className="subtle">
                    <code>{line.item.code}</code>
                  </span>
                </th>
                <td className="numeric" data-label={t('recipe.column.quantity')}>
                  {groupDigits(line.quantity)} {unitName(line.item.baseUnitCode)}
                </td>
                <td className="numeric" data-label={t('recipe.column.unitCost')}>
                  {line.unitCost === null ? (
                    <span className="subtle">{t('recipe.noLotCost')}</span>
                  ) : (
                    <>
                      {groupDigits(line.unitCost)}
                      <span className="subtle"> · {line.costLot}</span>
                    </>
                  )}
                </td>
                <td className="numeric" data-label={t('recipe.column.cost')}>
                  {line.cost === null ? '–' : groupDigits(line.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="recipe-version__cost">
        {version.lines.every((line) => line.cost === null)
          ? t('recipe.cost.none')
          : t(version.theoreticalCost.complete ? 'recipe.cost.total' : 'recipe.cost.partial', {
              total: groupDigits(version.theoreticalCost.total),
            })}
      </p>
      {onCorrect && (
        <button type="button" className="button button--ghost button--small" onClick={onCorrect}>
          {t('recipe.correct.open', { number: version.number })}
        </button>
      )}
    </article>
  );
}

interface Row extends RecipeLineInput {
  key: number;
}

/** A new version (with its start date), or the corrected lines of one still to start. */
function LinesForm({
  kind,
  subjectId,
  title,
  correcting,
  onClose,
}: {
  kind: RecipeKind;
  subjectId: string;
  title: string;
  correcting?: RecipeVersionView;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const formId = useId();
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const nextKey = useRef(0);
  const withKey = (line: RecipeLineInput): Row => ({ ...line, key: nextKey.current++ });
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [rows, setRows] = useState<Row[]>(() =>
    (
      correcting?.lines.map((l) => ({ itemId: l.item.id, quantity: l.quantity })) ?? [
        { itemId: '', quantity: '' },
      ]
    ).map(withKey),
  );

  const save = useMutation({
    mutationFn: () => {
      const lines = rows.map(({ itemId, quantity }) => ({ itemId, quantity: quantity.trim() }));
      return correcting
        ? replaceRecipeLines(correcting.id, lines)
        : addRecipeVersion(kind, subjectId, { effectiveFrom, lines });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.recipe(kind, subjectId), saved);
      onClose();
    },
  });

  const issues = lineIssues(save.error);
  const setRow = (key: number, change: Partial<RecipeLineInput>) =>
    setRows((all) => all.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const active = (items.data ?? []).filter((i) => i.active);
  const choosable = (current: string): ItemView[] =>
    (items.data ?? []).filter((i) => i.active || i.id === current);
  const itemOf = (id: string) => active.find((i) => i.id === id);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form className="recipe-form" onSubmit={submit} aria-labelledby={`${formId}-title`}>
      <h4 id={`${formId}-title`}>{title}</h4>
      {!correcting && (
        <div className="field">
          <label htmlFor={`${formId}-from`}>{t('recipe.field.effectiveFrom')}</label>
          <DateField
            id={`${formId}-from`}
            required
            describedBy={`${formId}-from-hint`}
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />
          <p id={`${formId}-from-hint`} className="subtle">
            {t('recipe.field.effectiveFromHint')}
          </p>
        </div>
      )}
      <p className="subtle">
        {t(kind === 'menu' ? 'recipe.lines.hintMenu' : 'recipe.lines.hintModifier')}
      </p>
      {rows.map((row, index) => {
        const n = index + 1;
        const issue = issues.find((i) => i.lineNo === n);
        const item = itemOf(row.itemId);
        return (
          <div key={row.key} className="document-line">
            <div className="field">
              <label htmlFor={`${formId}-item-${row.key}`}>{t('recipe.line.item', { n })}</label>
              <select
                id={`${formId}-item-${row.key}`}
                required
                value={row.itemId}
                aria-invalid={issue ? true : undefined}
                onChange={(e) => setRow(row.key, { itemId: e.target.value })}
              >
                <option value="">{t('recipe.line.chooseItem')}</option>
                {choosable(row.itemId).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} · {language === 'th' ? i.nameTh : i.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-qty-${row.key}`}>
                {item
                  ? t('recipe.line.quantityIn', {
                      n,
                      unit: unitName(units.data ?? [], item.baseUnitCode, language),
                    })
                  : t('recipe.line.quantity', { n })}
              </label>
              <input
                id={`${formId}-qty-${row.key}`}
                required
                inputMode="decimal"
                autoComplete="off"
                value={row.quantity}
                aria-invalid={issue ? true : undefined}
                onChange={(e) => setRow(row.key, { quantity: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="button button--ghost button--small"
              aria-label={t('recipe.line.removeLabel', { n })}
              disabled={rows.length === 1}
              onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
            >
              {t('recipe.line.remove')}
            </button>
            {issue && (
              <p className="field-error purchase-unit-row__error">
                {t('recipe.line.issue', {
                  n,
                  problem: t(LINE_PROBLEMS[issue.problem] ?? 'recipe.problem.unknown'),
                })}
              </p>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="button button--ghost button--small"
        onClick={() => setRows((all) => [...all, withKey({ itemId: '', quantity: '' })])}
      >
        {t('recipe.line.add')}
      </button>
      {save.isError && (
        <ErrorCallout
          error={save.error}
          messages={SAVE_ERRORS}
          describe={(error) => describeError(error, language)}
        />
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending
            ? t('recipe.saving')
            : t(correcting ? 'recipe.correct.save' : 'recipe.add.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('recipe.cancel')}
        </button>
      </div>
    </form>
  );
}

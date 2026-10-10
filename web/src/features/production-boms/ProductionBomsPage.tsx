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
import { listItems, listUnits, unitName, type ItemView } from '@/features/items/items.api';
import { useAuthStore } from '@/stores/auth.store';
import {
  addBomVersion,
  correctBomVersion,
  createProductionBom,
  getProductionBom,
  listProductionBoms,
  previewBom,
  updateProductionBom,
  WEIGHT_UNITS,
  type BomLineIssue,
  type BomLines,
  type BomLineView,
  type BomPreview,
  type BomSide,
  type BomTiming,
  type BomVersionView,
  type ProductionBomSummary,
  type ProductionBomView,
} from './production-boms.api';

/** Kept as a key, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const TIMING: Record<BomTiming, { key: MessageKey; tone: string }> = {
  current: { key: 'bom.timing.current', tone: 'up' },
  scheduled: { key: 'bom.timing.scheduled', tone: 'neutral' },
  past: { key: 'bom.timing.past', tone: 'disabled' },
};

const SAVE_ERRORS: Record<string, MessageKey> = {
  PRODUCTION_BOM_CODE_TAKEN: 'bom.error.codeTaken',
  PRODUCTION_BOM_VERSION_OVERLAP: 'bom.error.overlap',
  PRODUCTION_BOM_VERSION_IN_EFFECT: 'bom.error.inEffect',
  PRODUCTION_BOM_INACTIVE: 'bom.error.inactive',
  STALE_REVISION: 'bom.error.changed',
  INVALID_DATE: 'bom.error.date',
  VALIDATION_FAILED: 'bom.error.invalid',
};

const LINE_PROBLEMS: Record<string, MessageKey> = {
  unknown_item: 'bom.problem.unknown_item',
  inactive_item: 'bom.problem.inactive_item',
  duplicate_item: 'bom.problem.duplicate_item',
  on_both_sides: 'bom.problem.on_both_sides',
  not_a_decimal: 'bom.problem.not_a_decimal',
  not_positive: 'bom.problem.not_positive',
  too_many_decimals: 'bom.problem.too_many_decimals',
  too_large: 'bom.problem.too_large',
  weight_missing: 'bom.problem.weight_missing',
  weight_not_needed: 'bom.problem.weight_not_needed',
  weight_invalid: 'bom.problem.weight_invalid',
  ratio_invalid: 'bom.problem.ratio_invalid',
};

/** The labels of a line's fields, per side. */
const SIDE: Record<
  BomSide,
  { item: MessageKey; quantity: MessageKey; quantityIn: MessageKey; weight: MessageKey }
> = {
  input: {
    item: 'bom.input.item',
    quantity: 'bom.input.quantity',
    quantityIn: 'bom.input.quantityIn',
    weight: 'bom.input.weight',
  },
  output: {
    item: 'bom.output.item',
    quantity: 'bom.output.quantity',
    quantityIn: 'bom.output.quantityIn',
    weight: 'bom.output.weight',
  },
};

const VERSION_PROBLEMS: Record<string, MessageKey> = {
  no_inputs: 'bom.versionProblem.no_inputs',
  no_outputs: 'bom.versionProblem.no_outputs',
  outputs_heavier_than_inputs: 'bom.versionProblem.outputs_heavier_than_inputs',
  ratios_incomplete: 'bom.versionProblem.ratios_incomplete',
  ratios_not_100: 'bom.versionProblem.ratios_not_100',
};

function describeError(
  error: ApiError,
  language: 'th' | 'en',
): { key: MessageKey; params?: MessageParams } | undefined {
  if (error.code === 'PRODUCTION_BOM_TOO_EARLY') {
    const earliest = (error.details as { earliest?: string } | undefined)?.earliest ?? '';
    return { key: 'bom.error.tooEarly', params: { date: formatBusinessDate(earliest, language) } };
  }
  if (error.code === 'INVALID_PRODUCTION_BOM') return { key: 'bom.error.lines' };
  return undefined;
}

function savedIssues(error: unknown): { issues: BomLineIssue[]; problems: string[] } {
  if (!(error instanceof ApiError) || error.code !== 'INVALID_PRODUCTION_BOM') {
    return { issues: [], problems: [] };
  }
  const details = error.details as { issues?: BomLineIssue[]; problems?: string[] } | undefined;
  return { issues: details?.issues ?? [], problems: details?.problems ?? [] };
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

/**
 * Production BOMs (#12): how the plant turns inputs into outputs, with each output's expected
 * yield and the share of the batch cost it carries (ADR-0004, ADR-0026). Plant and finance read
 * them; only the admin (`production_bom:manage`) sees the buttons that change them.
 */
export function ProductionBomsPage() {
  const { t } = useI18n();
  const canManage =
    useAuthStore((s) => s.user?.permissions.includes(Permission.PRODUCTION_BOM_MANAGE)) ?? false;
  const [includeInactive, setIncludeInactive] = useState(false);
  const boms = useQuery({
    queryKey: qk.productionBomList(includeInactive),
    queryFn: () => listProductionBoms(includeInactive),
  });
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (boms.data ?? []).filter(
      (bom) =>
        !needle ||
        [bom.code, bom.nameTh, bom.nameEn].some((s) => s.toLocaleLowerCase().includes(needle)),
    );
  }, [boms.data, search]);

  return (
    <section className="page page--wide" aria-labelledby="bom-title">
      <div className="page__header">
        <div>
          <h1 id="bom-title">{t('bom.title')}</h1>
          <p className="muted">{t('bom.intro')}</p>
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
            {t('bom.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}
        </p>
      )}

      {creating && (
        <section className="panel" aria-labelledby="bom-create-title">
          <h2 id="bom-create-title">{t('bom.create.title')}</h2>
          <BomForm
            mode={{ kind: 'create' }}
            onClose={() => setCreating(false)}
            onSaved={(bom) => {
              setCreating(false);
              setOpenId(bom.id);
              setNotice({ key: 'bom.create.done', params: { code: bom.code } });
            }}
          />
        </section>
      )}
      {openId && (
        <BomPanel
          key={openId}
          id={openId}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onNotice={setNotice}
        />
      )}

      <div className="filters">
        <div className="field">
          <label htmlFor="bom-search">{t('bom.search')}</label>
          <input
            id="bom-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="check-field">
          <input
            id="bom-inactive"
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          <label htmlFor="bom-inactive">{t('bom.filter.includeInactive')}</label>
        </div>
      </div>

      {boms.isPending && (
        <p className="muted" role="status">
          {t('bom.loading')}
        </p>
      )}
      {boms.isError && <ErrorCallout error={boms.error} />}

      {boms.data && (
        <>
          <p className="subtle" role="status">
            {t('bom.count', { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <p className="muted">{t('bom.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('bom.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('bom.column.bom')}</th>
                    <th scope="col">{t('bom.column.current')}</th>
                    <th scope="col" className="numeric">
                      {t('bom.column.yield')}
                    </th>
                    <th scope="col">{t('bom.column.next')}</th>
                    <th scope="col">{t('bom.column.status')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('bom.column.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((bom) => (
                    <BomRow
                      key={bom.id}
                      bom={bom}
                      open={openId === bom.id}
                      onOpen={() => {
                        setOpenId(openId === bom.id ? null : bom.id);
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

function BomRow({
  bom,
  open,
  onOpen,
}: {
  bom: ProductionBomSummary;
  open: boolean;
  onOpen: () => void;
}) {
  const { t, language } = useI18n();
  const name = language === 'th' ? bom.nameTh : bom.nameEn;
  const otherName = language === 'th' ? bom.nameEn : bom.nameTh;
  return (
    <tr className={bom.active ? undefined : 'row--off'}>
      <th scope="row">
        <span className="cell-title">{name}</span>
        <span className="subtle">
          <code>{bom.code}</code> {otherName}
        </span>
      </th>
      <td data-label={t('bom.column.current')}>
        {bom.current
          ? t('bom.versionFrom', {
              number: bom.current.number,
              date: formatBusinessDate(bom.current.effectiveFrom, language),
            })
          : t('bom.noneInForce')}
      </td>
      <td className="numeric" data-label={t('bom.column.yield')}>
        {bom.current ? `${bom.current.yieldPercent} %` : '–'}
      </td>
      <td data-label={t('bom.column.next')}>
        {bom.scheduled
          ? t('bom.versionFrom', {
              number: bom.scheduled.number,
              date: formatBusinessDate(bom.scheduled.effectiveFrom, language),
            })
          : '–'}
      </td>
      <td data-label={t('bom.column.status')}>
        <span className={`badge badge--${bom.active ? 'up' : 'neutral'}`}>
          {t(bom.active ? 'bom.status.active' : 'bom.status.inactive')}
        </span>
      </td>
      <td>
        <button
          type="button"
          className="button button--ghost button--small"
          aria-label={t('bom.open.label', { name })}
          aria-expanded={open}
          onClick={onOpen}
        >
          {t('bom.open.short')}
        </button>
      </td>
    </tr>
  );
}

type FormMode =
  | { kind: 'create' }
  | { kind: 'version'; bom: ProductionBomView; from?: BomVersionView }
  | { kind: 'correct'; bom: ProductionBomView; version: BomVersionView };

/** One BOM: its versions newest first and, for the admin, the forms that change it. */
function BomPanel({
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
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detail = useQuery({ queryKey: qk.productionBom(id), queryFn: () => getProductionBom(id) });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const [form, setForm] = useState<FormMode | null>(null);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => headingRef.current?.focus(), []);

  const toggle = useMutation({
    mutationFn: (bom: ProductionBomView) =>
      updateProductionBom(bom.id, { revision: bom.revision, active: !bom.active }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(qk.productionBom(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: qk.productionBoms });
      onNotice({
        key: saved.active ? 'bom.reactivated' : 'bom.deactivated',
        params: { code: saved.code },
      });
    },
  });

  if (detail.isPending) {
    return (
      <p className="muted" role="status">
        {t('bom.loading')}
      </p>
    );
  }
  if (detail.isError) return <ErrorCallout error={detail.error} />;

  const bom = detail.data;
  const name = language === 'th' ? bom.nameTh : bom.nameEn;
  const unitOf = (code: string) => unitName(units.data ?? [], code, language);
  const current = bom.versions.find((v) => v.status === 'current');

  return (
    <section className="panel" aria-labelledby="bom-panel-title">
      <h2 id="bom-panel-title" ref={headingRef} tabIndex={-1}>
        {name} <code>{bom.code}</code>
      </h2>
      <p className="subtle">
        {t('bom.locationType.plant')} ·{' '}
        {t(bom.active ? 'bom.status.active' : 'bom.status.inactive')}
      </p>
      {renaming ? (
        <RenameForm
          bom={bom}
          onClose={() => setRenaming(false)}
          onSaved={(saved) => {
            setRenaming(false);
            onNotice({ key: 'bom.rename.done', params: { code: saved.code } });
          }}
        />
      ) : (
        <div className="actions">
          {canManage && (
            <>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setRenaming(true)}
              >
                {t('bom.rename.open')}
              </button>
              <button
                type="button"
                className="button button--ghost"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(bom)}
              >
                {t(bom.active ? 'bom.deactivate' : 'bom.reactivate')}
              </button>
            </>
          )}
          <button type="button" className="button button--ghost" onClick={onClose}>
            {t('bom.close')}
          </button>
        </div>
      )}
      {toggle.isError && <ErrorCallout error={toggle.error} messages={SAVE_ERRORS} />}

      <p className="subtle">{t('bom.ratioNote')}</p>
      {bom.versions.map((version) =>
        form?.kind === 'correct' && form.version.id === version.id ? (
          <BomForm
            key={version.id}
            mode={form}
            onClose={() => setForm(null)}
            onSaved={() => {
              setForm(null);
              onNotice({
                key: 'bom.correct.done',
                params: { number: version.number, code: bom.code },
              });
            }}
          />
        ) : (
          <VersionCard
            key={version.id}
            version={version}
            unitOf={unitOf}
            onCorrect={
              canManage && version.status === 'scheduled'
                ? () => setForm({ kind: 'correct', bom, version })
                : undefined
            }
          />
        ),
      )}

      {canManage &&
        bom.active &&
        (form?.kind === 'version' ? (
          <BomForm
            mode={form}
            onClose={() => setForm(null)}
            onSaved={(saved) => {
              setForm(null);
              onNotice({
                key: 'bom.version.done',
                params: { number: saved.versions[0]?.number ?? '', code: saved.code },
              });
            }}
          />
        ) : (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setForm({ kind: 'version', bom, from: current ?? bom.versions[0] })}
          >
            {t('bom.version.open')}
          </button>
        ))}
    </section>
  );
}

function VersionCard({
  version,
  unitOf,
  onCorrect,
}: {
  version: BomVersionView;
  unitOf: (code: string) => string;
  onCorrect?: () => void;
}) {
  const { t, language } = useI18n();
  const timing = TIMING[version.status];
  const headingId = useId();
  const nameOf = (line: BomLineView) => (language === 'th' ? line.item.nameTh : line.item.nameEn);
  return (
    <article className="recipe-version" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {t('bom.versionFrom', {
          number: version.number,
          date: formatBusinessDate(version.effectiveFrom, language),
        })}{' '}
        <span className={`badge badge--${timing.tone}`}>{t(timing.key)}</span>
      </h3>
      <div className="table-scroll">
        <table className="data-table">
          <caption>{t('bom.inputs.caption', { number: version.number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('bom.column.item')}</th>
              <th scope="col" className="numeric">
                {t('bom.column.quantity')}
              </th>
              <th scope="col" className="numeric">
                {t('bom.column.weight')}
              </th>
            </tr>
          </thead>
          <tbody>
            {version.inputs.map((line) => (
              <tr key={line.lineNo}>
                <th scope="row">
                  <span className="cell-title">{nameOf(line)}</span>
                  <span className="subtle">
                    <code>{line.item.code}</code>
                  </span>
                </th>
                <td className="numeric" data-label={t('bom.column.quantity')}>
                  {groupDigits(line.quantity)} {unitOf(line.item.baseUnitCode)}
                </td>
                <td className="numeric" data-label={t('bom.column.weight')}>
                  {groupDigits(line.weightKg)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <caption>{t('bom.outputs.caption', { number: version.number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('bom.column.item')}</th>
              <th scope="col" className="numeric">
                {t('bom.column.quantity')}
              </th>
              <th scope="col" className="numeric">
                {t('bom.column.weight')}
              </th>
              <th scope="col" className="numeric">
                {t('bom.column.yield')}
              </th>
              <th scope="col" className="numeric">
                {t('bom.column.ratio')}
              </th>
            </tr>
          </thead>
          <tbody>
            {version.outputs.map((line) => (
              <tr key={line.lineNo}>
                <th scope="row">
                  <span className="cell-title">{nameOf(line)}</span>
                  <span className="subtle">
                    <code>{line.item.code}</code>
                  </span>
                </th>
                <td className="numeric" data-label={t('bom.column.quantity')}>
                  {groupDigits(line.quantity)} {unitOf(line.item.baseUnitCode)}
                </td>
                <td className="numeric" data-label={t('bom.column.weight')}>
                  {groupDigits(line.weightKg)}
                </td>
                <td className="numeric" data-label={t('bom.column.yield')}>
                  {line.yieldPercent} %
                </td>
                <td className="numeric" data-label={t('bom.column.ratio')}>
                  {line.allocationRatio} %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="recipe-version__cost">
        {t('bom.summary', {
          input: groupDigits(version.inputWeightKg),
          output: groupDigits(version.outputWeightKg),
          waste: groupDigits(version.wasteKg),
          yield: version.yieldPercent,
        })}
      </p>
      <p className="subtle">
        {t(version.ratiosOverridden ? 'bom.ratios.overridden' : 'bom.ratios.byWeight')}
      </p>
      {onCorrect && (
        <button type="button" className="button button--ghost button--small" onClick={onCorrect}>
          {t('bom.correct.open', { number: version.number })}
        </button>
      )}
    </article>
  );
}

function RenameForm({
  bom,
  onClose,
  onSaved,
}: {
  bom: ProductionBomView;
  onClose: () => void;
  onSaved: (bom: ProductionBomView) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const formId = useId();
  const [nameTh, setNameTh] = useState(bom.nameTh);
  const [nameEn, setNameEn] = useState(bom.nameEn);
  const save = useMutation({
    mutationFn: () =>
      updateProductionBom(bom.id, {
        revision: bom.revision,
        nameTh: nameTh.trim(),
        nameEn: nameEn.trim(),
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(qk.productionBom(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: qk.productionBoms });
      onSaved(saved);
    },
  });
  return (
    <form
      className="recipe-form"
      aria-label={t('bom.rename.open')}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="field">
        <label htmlFor={`${formId}-th`}>{t('bom.field.nameTh')}</label>
        <input
          id={`${formId}-th`}
          required
          maxLength={120}
          value={nameTh}
          onChange={(e) => setNameTh(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-en`}>{t('bom.field.nameEn')}</label>
        <input
          id={`${formId}-en`}
          required
          maxLength={120}
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
        />
      </div>
      {save.isError && <ErrorCallout error={save.error} messages={SAVE_ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? t('bom.saving') : t('bom.rename.save')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('bom.cancel')}
        </button>
      </div>
    </form>
  );
}

interface Row {
  key: number;
  itemId: string;
  quantity: string;
  expectedWeightKg: string;
  allocationRatio: string;
}

const blankRow = (key: number): Row => ({
  key,
  itemId: '',
  quantity: '',
  expectedWeightKg: '',
  allocationRatio: '',
});

/** The lines as the API takes them: only rows with an item, blanks left out. */
function linesOf(inputs: Row[], outputs: Row[], override: boolean): BomLines {
  const base = (row: Row) => ({
    itemId: row.itemId,
    quantity: row.quantity.trim(),
    expectedWeightKg: row.expectedWeightKg.trim() || null,
  });
  return {
    inputs: inputs.filter((r) => r.itemId).map(base),
    outputs: outputs
      .filter((r) => r.itemId)
      .map((row) => ({
        ...base(row),
        allocationRatio: override ? row.allocationRatio.trim() || null : null,
      })),
  };
}

/**
 * A new BOM (with its first version), a new version, or the corrected lines of a version still
 * to start. Weights, yield and ratios follow the lines as they are typed (the API previews them).
 */
function BomForm({
  mode,
  onClose,
  onSaved,
}: {
  mode: FormMode;
  onClose: () => void;
  onSaved: (bom: ProductionBomView) => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const formId = useId();
  const items = useQuery({ queryKey: qk.items, queryFn: listItems });
  const units = useQuery({ queryKey: qk.units, queryFn: listUnits, staleTime: Infinity });
  const nextKey = useRef(0);
  const source =
    mode.kind === 'correct' ? mode.version : mode.kind === 'version' ? mode.from : undefined;
  const toRow = (
    line: { item: { id: string }; quantity: string; expectedWeightKg: string | null },
    ratio = '',
  ): Row => ({
    key: nextKey.current++,
    itemId: line.item.id,
    quantity: line.quantity,
    expectedWeightKg: line.expectedWeightKg ?? '',
    allocationRatio: ratio,
  });
  const [code, setCode] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [inputs, setInputs] = useState<Row[]>(() =>
    source ? source.inputs.map((l) => toRow(l)) : [blankRow(nextKey.current++)],
  );
  const [outputs, setOutputs] = useState<Row[]>(() =>
    source
      ? source.outputs.map((l) => toRow(l, source.ratiosOverridden ? l.allocationRatio : ''))
      : [blankRow(nextKey.current++)],
  );
  const [override, setOverride] = useState(source?.ratiosOverridden ?? false);

  const lines = linesOf(inputs, outputs, override);
  const settled = useSettled(JSON.stringify(lines));
  const settledLines = JSON.parse(settled) as BomLines;
  const ready =
    settledLines.inputs.length > 0 &&
    settledLines.outputs.length > 0 &&
    [...settledLines.inputs, ...settledLines.outputs].every((l) => l.quantity !== '');
  const preview = useQuery({
    queryKey: qk.productionBomPreview(settled),
    queryFn: () => previewBom(settledLines),
    enabled: ready,
    retry: false,
  });

  const save = useMutation({
    mutationFn: () => {
      if (mode.kind === 'create') {
        return createProductionBom({
          code: code.trim(),
          nameTh: nameTh.trim(),
          nameEn: nameEn.trim(),
          locationType: 'plant',
          effectiveFrom,
          ...lines,
        });
      }
      if (mode.kind === 'version') return addBomVersion(mode.bom.id, { effectiveFrom, ...lines });
      return correctBomVersion(mode.version.id, lines);
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(qk.productionBom(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: qk.productionBoms });
      onSaved(saved);
    },
  });

  const fromSave = savedIssues(save.error);
  const shownPreview: BomPreview | undefined = preview.data;
  const issues = save.isError ? fromSave.issues : (shownPreview?.issues ?? []);
  const problems = save.isError ? fromSave.problems : (shownPreview?.problems ?? []);
  const itemsList = items.data ?? [];
  const itemOf = (id: string) => itemsList.find((i) => i.id === id);
  const choosable = (current: string): ItemView[] =>
    itemsList.filter((i) => i.active || i.id === current);
  const unitOf = (code: string) => unitName(units.data ?? [], code, language);

  // The preview lists outputs in the order sent, which skips rows with no item yet.
  const previewOutput = (row: Row) => {
    const index = outputs.filter((r) => r.itemId).findIndex((r) => r.key === row.key);
    return index < 0 ? undefined : shownPreview?.figures?.outputs[index];
  };

  const turnOverride = (on: boolean) => {
    setOverride(on);
    if (on) {
      // Start from the weight shares, so the person adjusts rather than types every ratio.
      setOutputs((all) =>
        all.map((row) => ({
          ...row,
          allocationRatio: row.allocationRatio || previewOutput(row)?.defaultRatio || '',
        })),
      );
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const sideRows = (side: BomSide) => {
    const rows = side === 'input' ? inputs : outputs;
    const setRows = side === 'input' ? setInputs : setOutputs;
    const setRow = (key: number, change: Partial<Row>) =>
      setRows((all) => all.map((row) => (row.key === key ? { ...row, ...change } : row)));
    return (
      <fieldset className="document-lines">
        <legend>{t(side === 'input' ? 'bom.inputs.legend' : 'bom.outputs.legend')}</legend>
        <p className="subtle">{t(side === 'input' ? 'bom.inputs.hint' : 'bom.outputs.hint')}</p>
        {rows.map((row, index) => {
          const n = index + 1;
          const item = itemOf(row.itemId);
          const issue = issues.find(
            (i) =>
              i.side === side &&
              i.lineNo === rows.filter((r) => r.itemId).findIndex((r) => r.key === row.key) + 1,
          );
          const needsWeight = item !== undefined && !WEIGHT_UNITS.includes(item.baseUnitCode);
          const figures = side === 'output' ? previewOutput(row) : undefined;
          const labels = SIDE[side];
          return (
            <div key={row.key} className="document-line">
              <div className="field">
                <label htmlFor={`${formId}-${side}-item-${row.key}`}>{t(labels.item, { n })}</label>
                <select
                  id={`${formId}-${side}-item-${row.key}`}
                  value={row.itemId}
                  aria-invalid={issue ? true : undefined}
                  onChange={(e) => setRow(row.key, { itemId: e.target.value })}
                >
                  <option value="">{t('bom.line.chooseItem')}</option>
                  {choosable(row.itemId).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code} · {language === 'th' ? i.nameTh : i.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${formId}-${side}-qty-${row.key}`}>
                  {item
                    ? t(labels.quantityIn, {
                        n,
                        unit: unitOf(item.baseUnitCode),
                      })
                    : t(labels.quantity, { n })}
                </label>
                <input
                  id={`${formId}-${side}-qty-${row.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={row.quantity}
                  aria-invalid={issue ? true : undefined}
                  onChange={(e) => setRow(row.key, { quantity: e.target.value })}
                />
              </div>
              {needsWeight && (
                <div className="field">
                  <label htmlFor={`${formId}-${side}-kg-${row.key}`}>
                    {t(labels.weight, { n })}
                  </label>
                  <input
                    id={`${formId}-${side}-kg-${row.key}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={row.expectedWeightKg}
                    aria-invalid={issue ? true : undefined}
                    onChange={(e) => setRow(row.key, { expectedWeightKg: e.target.value })}
                  />
                </div>
              )}
              {side === 'output' && override && (
                <div className="field">
                  <label htmlFor={`${formId}-ratio-${row.key}`}>
                    {t('bom.output.ratio', { n })}
                  </label>
                  <input
                    id={`${formId}-ratio-${row.key}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={row.allocationRatio}
                    aria-invalid={issue ? true : undefined}
                    onChange={(e) => setRow(row.key, { allocationRatio: e.target.value })}
                  />
                </div>
              )}
              <button
                type="button"
                className="button button--ghost button--small"
                aria-label={t('bom.line.removeLabel', {
                  side: t(side === 'input' ? 'bom.inputs.legend' : 'bom.outputs.legend'),
                  n,
                })}
                disabled={rows.length === 1}
                onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
              >
                {t('bom.line.remove')}
              </button>
              {figures && (
                <p className="subtle bom-line__figures">
                  {t(override ? 'bom.line.figuresStated' : 'bom.line.figures', {
                    weight: groupDigits(figures.weightKg),
                    yield: figures.yieldPercent,
                    ratio: figures.defaultRatio,
                  })}
                </p>
              )}
              {issue && (
                <p className="field-error purchase-unit-row__error">
                  {t('bom.line.issue', {
                    n,
                    problem: t(LINE_PROBLEMS[issue.problem] ?? 'bom.problem.unknown'),
                  })}
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setRows((all) => [...all, blankRow(nextKey.current++)])}
        >
          {t(side === 'input' ? 'bom.inputs.add' : 'bom.outputs.add')}
        </button>
      </fieldset>
    );
  };

  const title =
    mode.kind === 'version'
      ? t('bom.version.title')
      : mode.kind === 'correct'
        ? t('bom.correct.title', { number: mode.version.number })
        : undefined;

  return (
    <form className="recipe-form" onSubmit={submit} aria-label={title ?? t('bom.create.title')}>
      {title && <h3>{title}</h3>}
      {mode.kind === 'create' && (
        <>
          <div className="field">
            <label htmlFor={`${formId}-code`}>{t('bom.field.code')}</label>
            <input
              id={`${formId}-code`}
              required
              maxLength={32}
              autoComplete="off"
              aria-describedby={`${formId}-code-hint`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <p id={`${formId}-code-hint`} className="subtle">
              {t('bom.field.codeHint')}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${formId}-th`}>{t('bom.field.nameTh')}</label>
            <input
              id={`${formId}-th`}
              required
              maxLength={120}
              value={nameTh}
              onChange={(e) => setNameTh(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${formId}-en`}>{t('bom.field.nameEn')}</label>
            <input
              id={`${formId}-en`}
              required
              maxLength={120}
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
          <p className="subtle">{t('bom.field.locationType')}</p>
        </>
      )}
      {mode.kind !== 'correct' && (
        <div className="field">
          <label htmlFor={`${formId}-from`}>{t('bom.field.effectiveFrom')}</label>
          <DateField
            id={`${formId}-from`}
            required
            describedBy={`${formId}-from-hint`}
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />
          <p id={`${formId}-from-hint`} className="subtle">
            {t('bom.field.effectiveFromHint')}
          </p>
        </div>
      )}

      {sideRows('input')}
      <div className="check-field">
        <input
          id={`${formId}-override`}
          type="checkbox"
          checked={override}
          onChange={(e) => turnOverride(e.target.checked)}
        />
        <label htmlFor={`${formId}-override`}>{t('bom.override.label')}</label>
      </div>
      <p className="subtle">{t('bom.override.hint')}</p>
      {sideRows('output')}

      <div className="bom-preview" aria-live="polite">
        {shownPreview?.figures ? (
          <p>
            {t('bom.summary', {
              input: groupDigits(shownPreview.figures.inputWeightKg),
              output: groupDigits(shownPreview.figures.outputWeightKg),
              waste: groupDigits(shownPreview.figures.wasteKg),
              yield: shownPreview.figures.yieldPercent,
            })}
          </p>
        ) : (
          <p className="subtle">{t('bom.preview.waiting')}</p>
        )}
        {override && shownPreview?.statedRatioTotal && (
          <p>{t('bom.override.total', { total: shownPreview.statedRatioTotal })}</p>
        )}
        {problems.map((problem) => (
          <p key={problem} className="field-error">
            {t(VERSION_PROBLEMS[problem] ?? 'bom.problem.unknown')}
          </p>
        ))}
      </div>

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
            ? t('bom.saving')
            : t(
                mode.kind === 'create'
                  ? 'bom.create.save'
                  : mode.kind === 'version'
                    ? 'bom.version.save'
                    : 'bom.correct.save',
              )}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('bom.cancel')}
        </button>
      </div>
    </form>
  );
}

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
  CREATABLE_TYPES,
  createLocation,
  listLocations,
  supersedeLocation,
  updateLocation,
  type CreatableType,
  type LocationType,
  type LocationView,
} from './locations.api';

type StatusFilter = 'active' | 'inactive' | 'all';

/** Kept as a key, not as text, so it follows a language switch made after it appeared. */
interface Notice {
  key: MessageKey;
  params: MessageParams;
}

const TYPE_LABEL: Record<LocationType, MessageKey> = {
  plant: 'locations.type.plant',
  warehouse: 'locations.type.warehouse',
  branch: 'locations.type.branch',
  in_transit: 'locations.type.in_transit',
  subcontractor: 'locations.type.subcontractor',
};

const FILTERS: Record<StatusFilter, MessageKey> = {
  active: 'filter.active',
  inactive: 'filter.inactive',
  all: 'filter.all',
};

const ERRORS: Record<string, MessageKey> = {
  INVALID_LOCATION_CODE: 'locations.error.code',
  LOCATION_CODE_TAKEN: 'locations.error.codeTaken',
  LOCATION_CODE_IN_USE: 'locations.error.codeInUse',
  LOCATION_CHANGED: 'locations.error.changed',
  LOCATION_SUPERSEDED: 'locations.error.superseded',
  LOCATION_SYSTEM_MANAGED: 'locations.error.systemManaged',
  SUPERSEDE_DIFFERENT_TYPE: 'locations.error.supersedeType',
  SUPERSEDE_REPLACEMENT_INACTIVE: 'locations.error.supersedeInactive',
  VALIDATION_FAILED: 'locations.error.invalid',
};

export function LocationsPage() {
  const { t, language } = useI18n();
  const canManage = useAuthStore((s) => s.user?.permissions.includes(Permission.LOCATION_MANAGE));
  const locations = useQuery({ queryKey: qk.locations, queryFn: listLocations });
  const [type, setType] = useState<LocationType | ''>('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const shown = useMemo(
    () =>
      (locations.data ?? []).filter(
        (l) =>
          (!type || l.type === type) && (status === 'all' || l.active === (status === 'active')),
      ),
    [locations.data, type, status],
  );
  const editing = locations.data?.find((l) => l.id === editingId) ?? null;
  const nameOf = (l: LocationView) => (language === 'th' ? l.nameTh : l.nameEn);

  return (
    <section className="page page--wide" aria-labelledby="locations-title">
      <div className="page__header">
        <div>
          <h1 id="locations-title">{t('locations.title')}</h1>
          <p className="muted">{t('locations.intro')}</p>
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
            {t('locations.create.open')}
          </button>
        )}
      </div>

      {notice && (
        <p className="callout callout--success" role="status">
          {t(notice.key, notice.params)}
        </p>
      )}

      {creating && (
        <CreateLocationForm
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setNotice(
              created.inTransit
                ? {
                    key: 'locations.create.doneWithTransit',
                    params: { code: created.code, transit: created.inTransit.code },
                  }
                : { key: 'locations.create.done', params: { code: created.code } },
            );
          }}
        />
      )}
      {canManage && editing && locations.data && (
        <EditLocationForm
          key={editing.id}
          location={editing}
          all={locations.data}
          onClose={() => setEditingId(null)}
          onSaved={(n) => {
            setEditingId(null);
            setNotice(n);
          }}
        />
      )}

      <div className="filters">
        <div className="field">
          <label htmlFor="locations-type">{t('locations.filter.type')}</label>
          <select
            id="locations-type"
            value={type}
            onChange={(e) => setType(e.target.value as LocationType | '')}
          >
            <option value="">{t('locations.filter.allTypes')}</option>
            {(['plant', 'warehouse', 'branch', 'in_transit'] as const).map((value) => (
              <option key={value} value={value}>
                {t(TYPE_LABEL[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="locations-status">{t('filter.show')}</label>
          <select
            id="locations-status"
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

      {locations.isPending && (
        <p className="muted" role="status">
          {t('locations.loading')}
        </p>
      )}
      {locations.isError && <ErrorCallout error={locations.error} />}

      {locations.data && (
        <>
          <p className="subtle" role="status">
            {t('locations.count', { count: shown.length })}
          </p>
          {shown.length === 0 ? (
            <p className="muted">{t('locations.empty')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">{t('locations.table.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('locations.column.location')}</th>
                    <th scope="col">{t('locations.column.type')}</th>
                    <th scope="col">{t('locations.column.code')}</th>
                    <th scope="col">{t('locations.column.status')}</th>
                    {canManage && (
                      <th scope="col">
                        <span className="visually-hidden">{t('locations.column.actions')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((location) => (
                    <tr key={location.id}>
                      <th scope="row">
                        <span className="cell-title">{nameOf(location)}</span>
                        <span className="subtle">
                          <code>{location.code}</code>{' '}
                          {language === 'th' ? location.nameEn : location.nameTh}
                        </span>
                      </th>
                      <td>
                        {t(TYPE_LABEL[location.type])}
                        {location.origin && (
                          <span className="subtle">
                            {' '}
                            {t('locations.inTransitOf', { code: location.origin.code })}
                          </span>
                        )}
                      </td>
                      <td>
                        {location.type === 'in_transit' ? (
                          <span className="subtle">{t('locations.systemManaged')}</span>
                        ) : (
                          <span className="subtle">
                            {t(
                              location.firstUsedAt
                                ? 'locations.code.fixed'
                                : 'locations.code.correctable',
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge--${location.active ? 'up' : 'neutral'}`}>
                          {t(location.active ? 'status.active' : 'status.inactive')}
                        </span>
                        {location.supersededBy && (
                          <span className="subtle">
                            {' '}
                            {t('locations.status.superseded', {
                              code: location.supersededBy.code,
                            })}
                          </span>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          {location.type !== 'in_transit' && (
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              aria-label={t('locations.edit.label', { name: nameOf(location) })}
                              aria-expanded={editingId === location.id}
                              onClick={() => {
                                setEditingId(editingId === location.id ? null : location.id);
                                setCreating(false);
                                setNotice(null);
                              }}
                            >
                              {t('locations.edit.short')}
                            </button>
                          )}
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

function useAfterChange() {
  const queryClient = useQueryClient();
  return {
    refresh: () => queryClient.invalidateQueries({ queryKey: qk.locations }),
    // Someone else's change: fetch it, so closing and reopening shows the latest.
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.code === 'LOCATION_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: qk.locations });
      }
    },
  };
}

function CreateLocationForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (location: LocationView) => void;
}) {
  const { t } = useI18n();
  const after = useAfterChange();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState('');
  const [type, setType] = useState<CreatableType>('branch');
  const [nameTh, setNameTh] = useState('');
  const [nameEn, setNameEn] = useState('');

  useEffect(() => headingRef.current?.focus(), []);

  const create = useMutation({
    mutationFn: () =>
      createLocation({
        code: code.trim().toUpperCase(),
        type,
        nameTh: nameTh.trim(),
        nameEn: nameEn.trim(),
      }),
    onSuccess: async (created) => {
      await after.refresh();
      onCreated(created);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form className="panel" onSubmit={submit} aria-labelledby="create-location-title">
      <h2 id="create-location-title" ref={headingRef} tabIndex={-1}>
        {t('locations.create.title')}
      </h2>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="location-code">{t('locations.field.code')}</label>
          <input
            id="location-code"
            required
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className="input--code"
            aria-describedby="location-code-hint"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <p id="location-code-hint" className="subtle">
            {t('locations.field.codeHint')}
          </p>
        </div>
        <div className="field">
          <label htmlFor="location-type">{t('locations.field.type')}</label>
          <select
            id="location-type"
            aria-describedby="location-type-hint"
            value={type}
            onChange={(e) => setType(e.target.value as CreatableType)}
          >
            {CREATABLE_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(TYPE_LABEL[value])}
              </option>
            ))}
          </select>
          <p id="location-type-hint" className="subtle">
            {t('locations.field.typeHint')}
          </p>
        </div>
        <NameFields nameTh={nameTh} nameEn={nameEn} setNameTh={setNameTh} setNameEn={setNameEn} />
      </div>
      {create.isError && <ErrorCallout error={create.error} messages={ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={create.isPending}>
          {create.isPending ? t('locations.saving') : t('locations.create.submit')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('locations.cancel')}
        </button>
      </div>
    </form>
  );
}

function NameFields({
  nameTh,
  nameEn,
  setNameTh,
  setNameEn,
}: {
  nameTh: string;
  nameEn: string;
  setNameTh: (v: string) => void;
  setNameEn: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="field">
        <label htmlFor="location-name-th">{t('locations.field.nameTh')}</label>
        <input
          id="location-name-th"
          lang="th"
          required
          maxLength={120}
          value={nameTh}
          onChange={(e) => setNameTh(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="location-name-en">{t('locations.field.nameEn')}</label>
        <input
          id="location-name-en"
          lang="en"
          required
          maxLength={120}
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
        />
      </div>
    </>
  );
}

function EditLocationForm({
  location,
  all,
  onClose,
  onSaved,
}: {
  location: LocationView;
  all: LocationView[];
  onClose: () => void;
  onSaved: (notice: Notice) => void;
}) {
  const { t, language } = useI18n();
  const after = useAfterChange();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState(location.code);
  const [nameTh, setNameTh] = useState(location.nameTh);
  const [nameEn, setNameEn] = useState(location.nameEn);
  const [replacementId, setReplacementId] = useState('');
  const codeFixed = Boolean(location.firstUsedAt);

  useEffect(() => headingRef.current?.focus(), []);

  const save = useMutation({
    mutationFn: () =>
      updateLocation(location.id, {
        revision: location.revision,
        code: codeFixed ? undefined : code.trim().toUpperCase(),
        nameTh: nameTh.trim(),
        nameEn: nameEn.trim(),
      }),
    onSuccess: async (saved) => {
      await after.refresh();
      onSaved({ key: 'locations.edit.done', params: { code: saved.code } });
    },
    onError: after.onError,
  });

  const toggle = useMutation({
    mutationFn: () =>
      updateLocation(location.id, { revision: location.revision, active: !location.active }),
    onSuccess: async (saved) => {
      await after.refresh();
      onSaved({
        key: saved.active ? 'locations.reactivated' : 'locations.deactivated',
        params: { code: saved.code },
      });
    },
    onError: after.onError,
  });

  const supersede = useMutation({
    mutationFn: () => supersedeLocation(location.id, location.revision, replacementId),
    onSuccess: async (saved) => {
      await after.refresh();
      onSaved({
        key: 'locations.supersede.done',
        params: { code: saved.code, by: saved.supersededBy?.code ?? '' },
      });
    },
    onError: after.onError,
  });

  const candidates = all.filter(
    (l) => l.id !== location.id && l.type === location.type && l.active && !l.supersededBy,
  );
  const busy = save.isPending || toggle.isPending || supersede.isPending;
  const resetOthers = (keep: 'save' | 'toggle' | 'supersede') => {
    if (keep !== 'save') save.reset();
    if (keep !== 'toggle') toggle.reset();
    if (keep !== 'supersede') supersede.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    resetOthers('save');
    save.mutate();
  };

  return (
    <form className="panel" onSubmit={submit} aria-labelledby="edit-location-title">
      <h2 id="edit-location-title" ref={headingRef} tabIndex={-1}>
        {t('locations.edit.title', { code: location.code })}
      </h2>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="location-code">{t('locations.field.code')}</label>
          <input
            id="location-code"
            required
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className="input--code"
            readOnly={codeFixed}
            aria-describedby="location-code-hint"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <p id="location-code-hint" className="subtle">
            {codeFixed
              ? t('locations.field.codeFixed', { use: location.firstUse ?? '' })
              : t('locations.field.codeHint')}
          </p>
        </div>
        <NameFields nameTh={nameTh} nameEn={nameEn} setNameTh={setNameTh} setNameEn={setNameEn} />
      </div>
      {save.isError && <ErrorCallout error={save.error} messages={ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {save.isPending ? t('locations.saving') : t('locations.edit.submit')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('locations.close')}
        </button>
      </div>

      {!location.supersededBy && (
        <div className="panel__footer">
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            aria-describedby={location.active ? 'location-deactivate-hint' : undefined}
            onClick={() => {
              resetOthers('toggle');
              toggle.mutate();
            }}
          >
            {t(location.active ? 'locations.deactivate' : 'locations.reactivate')}
          </button>
          {location.active && (
            <p id="location-deactivate-hint" className="subtle">
              {t('locations.deactivate.hint')}
            </p>
          )}
          {toggle.isError && <ErrorCallout error={toggle.error} messages={ERRORS} />}
        </div>
      )}

      {!location.supersededBy && (
        <section className="panel__footer" aria-labelledby="supersede-title">
          <h3 id="supersede-title">{t('locations.supersede.title')}</h3>
          <p className="subtle">{t('locations.supersede.intro')}</p>
          {candidates.length === 0 ? (
            <p className="muted">{t('locations.supersede.none')}</p>
          ) : (
            <div className="inline-form">
              <div className="field">
                <label htmlFor="supersede-by">{t('locations.supersede.by')}</label>
                <select
                  id="supersede-by"
                  value={replacementId}
                  onChange={(e) => setReplacementId(e.target.value)}
                >
                  <option value="">{t('locations.selectLocation')}</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`${c.code} · ${language === 'th' ? c.nameTh : c.nameEn}`}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="button button--ghost"
                disabled={busy || !replacementId}
                onClick={() => {
                  resetOthers('supersede');
                  supersede.mutate();
                }}
              >
                {t('locations.supersede.submit')}
              </button>
            </div>
          )}
          {supersede.isError && <ErrorCallout error={supersede.error} messages={ERRORS} />}
        </section>
      )}
    </form>
  );
}

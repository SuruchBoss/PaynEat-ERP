// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { ErrorCallout } from '@/components/ErrorCallout';
import type { Language, MessageKey } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { Permission, ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role } from '@/lib/access';
import { useAuthStore } from '@/stores/auth.store';
import {
  createUser,
  grantRole,
  listUsers,
  revokeRole,
  type NewUser,
  type UserView,
} from './users.api';

const CREATE_ERRORS: Record<string, MessageKey> = {
  EMAIL_TAKEN: 'users.error.emailTaken',
  WEAK_PASSWORD: 'users.error.weakPassword',
  VALIDATION_FAILED: 'users.error.invalid',
};

const ROLE_ERRORS: Record<string, MessageKey> = {
  LAST_ADMIN: 'users.error.lastAdmin',
};

function formatDateTime(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function secondFactorKey(user: UserView): MessageKey {
  if (user.mfaEnabled) return 'users.mfa.on';
  return user.mfaRequired ? 'users.mfa.pending' : 'users.mfa.off';
}

export function UsersPage() {
  const { t, language } = useI18n();
  const canManage = useAuthStore((s) => s.user?.permissions.includes(Permission.USER_MANAGE));
  const users = useQuery({ queryKey: qk.users, queryFn: listUsers });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The created account's email, not a sentence: the notice follows a language switch.
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  const editing = users.data?.find((u) => u.id === editingId) ?? null;

  return (
    <section className="page page--wide" aria-labelledby="users-title">
      <div className="page__header">
        <div>
          <h1 id="users-title">{t('users.title')}</h1>
          <p className="muted">{t('users.intro')}</p>
        </div>
        {canManage && !creating && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setCreatedEmail(null);
            }}
          >
            {t('users.create.open')}
          </button>
        )}
      </div>

      {createdEmail && (
        <p className="callout callout--success" role="status">
          {t('users.create.done', { email: createdEmail })}
        </p>
      )}

      {creating && (
        <CreateUserForm
          onCancel={() => setCreating(false)}
          onCreated={(user) => {
            setCreating(false);
            setCreatedEmail(user.email);
          }}
        />
      )}

      {users.isPending && (
        <p className="muted" role="status">
          {t('users.loading')}
        </p>
      )}
      {users.isError && <ErrorCallout error={users.error} />}

      {users.data && (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">{t('users.table.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('users.column.name')}</th>
                <th scope="col">{t('users.column.roles')}</th>
                <th scope="col">{t('users.column.mfa')}</th>
                <th scope="col">{t('users.column.lastSignIn')}</th>
                {canManage && (
                  <th scope="col">
                    <span className="visually-hidden">{t('users.column.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={user.id}>
                  <th scope="row">
                    <span className="cell-title">{user.displayName}</span>
                    <span className="subtle">{user.email}</span>
                  </th>
                  <td>
                    {user.roles.length === 0 ? (
                      <span className="subtle">{t('users.noRoles')}</span>
                    ) : (
                      <ul className="chips">
                        {user.roles.map((role) => (
                          <li key={role} className="chip">
                            {t(ROLE_LABEL[role])}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge badge--${user.mfaEnabled ? 'up' : user.mfaRequired ? 'down' : 'neutral'}`}
                    >
                      {t(secondFactorKey(user))}
                    </span>
                  </td>
                  <td>
                    {user.lastLoginAt ? (
                      formatDateTime(user.lastLoginAt, language)
                    ) : (
                      <span className="subtle">{t('users.never')}</span>
                    )}
                  </td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        // Short on screen; the name is in the accessible name, which starts
                        // with the visible words (WCAG 2.5.3).
                        aria-label={t('users.roles.edit', { name: user.displayName })}
                        aria-expanded={editingId === user.id}
                        aria-controls="role-editor"
                        onClick={() => {
                          setEditingId(editingId === user.id ? null : user.id);
                          setCreatedEmail(null);
                        }}
                      >
                        {t('users.roles.editShort')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && editing && <RoleEditor user={editing} onClose={() => setEditingId(null)} />}
    </section>
  );
}

function RoleChecklist({
  legend,
  selected,
  disabled,
  onToggle,
}: {
  legend: string;
  selected: readonly Role[];
  disabled?: boolean;
  onToggle: (role: Role, checked: boolean) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <fieldset className="role-list" disabled={disabled}>
      <legend>{legend}</legend>
      {ROLES.map((role) => (
        <div key={role} className="role-option">
          <input
            id={`${id}-${role}`}
            type="checkbox"
            checked={selected.includes(role)}
            aria-describedby={`${id}-${role}-description`}
            onChange={(e) => onToggle(role, e.target.checked)}
          />
          <label htmlFor={`${id}-${role}`}>
            <span className="cell-title">{t(ROLE_LABEL[role])}</span>
            <span id={`${id}-${role}-description`} className="subtle">
              {t(ROLE_DESCRIPTION[role])}
              {role === 'admin' && ` ${t('role.admin.secondFactor')}`}
            </span>
          </label>
        </div>
      ))}
    </fieldset>
  );
}

function CreateUserForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (user: UserView) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState<NewUser>({
    email: '',
    displayName: '',
    password: '',
    locale: 'th',
    roles: [],
  });
  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: qk.users });
      onCreated(user);
    },
  });

  useEffect(() => headingRef.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ ...form, email: form.email.trim(), displayName: form.displayName.trim() });
  };

  return (
    <form className="panel" onSubmit={submit} aria-labelledby="create-user-title">
      <h2 id="create-user-title" ref={headingRef} tabIndex={-1}>
        {t('users.create.title')}
      </h2>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="new-user-name">{t('users.field.displayName')}</label>
          <input
            id="new-user-name"
            required
            maxLength={120}
            autoComplete="off"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="new-user-email">{t('users.field.email')}</label>
          <input
            id="new-user-email"
            type="email"
            required
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="new-user-password">{t('users.field.password')}</label>
          <input
            id="new-user-password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            aria-describedby="new-user-password-hint"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <p id="new-user-password-hint" className="subtle">
            {t('users.field.passwordHint')}
          </p>
        </div>
        <div className="field">
          <label htmlFor="new-user-locale">{t('users.field.locale')}</label>
          <select
            id="new-user-locale"
            value={form.locale}
            onChange={(e) => setForm({ ...form, locale: e.target.value as 'th' | 'en' })}
          >
            <option value="th">{t('language.th')}</option>
            <option value="en">{t('language.en')}</option>
          </select>
        </div>
      </div>
      <RoleChecklist
        legend={t('users.field.roles')}
        selected={form.roles}
        onToggle={(role, checked) =>
          setForm({
            ...form,
            roles: checked ? [...form.roles, role] : form.roles.filter((r) => r !== role),
          })
        }
      />
      {mutation.isError && <ErrorCallout error={mutation.error} messages={CREATE_ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={mutation.isPending}>
          {mutation.isPending ? t('users.saving') : t('users.create.submit')}
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          {t('users.cancel')}
        </button>
      </div>
    </form>
  );
}

function RoleEditor({ user, onClose }: { user: UserView; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // What changed, not a sentence: the message follows a language switch.
  const [changed, setChanged] = useState<{ role: Role; grant: boolean; name: string } | null>(null);
  const [pending, setPending] = useState<{ role: Role; grant: boolean } | null>(null);
  const mutation = useMutation({
    mutationFn: ({ role, grant }: { role: Role; grant: boolean }) =>
      grant ? grantRole(user.id, role) : revokeRole(user.id, role),
    onSuccess: (updated, { role, grant }) => {
      queryClient.setQueryData<UserView[]>(qk.users, (list) =>
        list?.map((u) => (u.id === updated.id ? updated : u)),
      );
      setChanged({ role, grant, name: updated.displayName });
    },
  });

  useEffect(() => headingRef.current?.focus(), [user.id]);

  const lastChange = changed
    ? t(changed.grant ? 'users.roles.granted' : 'users.roles.revoked', {
        role: t(ROLE_LABEL[changed.role]),
        name: changed.name,
      })
    : null;

  // The tick shows the choice at once while the API is asked; if it refuses, the
  // checklist goes back to what the API holds and the error says why. Local state, set
  // in the click handler itself: the mutation's own pending state arrives a tick later,
  // after React has already put the controlled checkbox back.
  const shown = pending
    ? pending.grant
      ? [...user.roles, pending.role]
      : user.roles.filter((r) => r !== pending.role)
    : user.roles;

  return (
    <section id="role-editor" className="panel" aria-labelledby="role-editor-title">
      <h2 id="role-editor-title" ref={headingRef} tabIndex={-1}>
        {t('users.roles.title', { name: user.displayName })}
      </h2>
      <p className="muted">{t('users.roles.intro')}</p>
      <RoleChecklist
        legend={t('users.roles.legend', { email: user.email })}
        selected={shown}
        disabled={mutation.isPending}
        onToggle={(role, grant) => {
          setChanged(null);
          setPending({ role, grant });
          mutation.mutate({ role, grant }, { onSettled: () => setPending(null) });
        }}
      />
      <p className="visually-hidden" role="status">
        {mutation.isPending ? t('users.saving') : (lastChange ?? '')}
      </p>
      {lastChange && !mutation.isPending && (
        <p className="subtle" aria-hidden="true">
          {lastChange}
        </p>
      )}
      {mutation.isError && <ErrorCallout error={mutation.error} messages={ROLE_ERRORS} />}
      <div className="actions">
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('users.roles.close')}
        </button>
      </div>
    </section>
  );
}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { qk } from '@/app/query-client';
import { ErrorCallout } from '@/components/ErrorCallout';
import type { MessageKey } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { formatDateTime, groupDigits } from '@/lib/format';
import {
  getCompanySettings,
  updateCompanySettings,
  type CompanySettings,
} from './company-settings.api';

const ERRORS: Record<string, MessageKey> = {
  COMPANY_SETTINGS_CHANGED: 'settings.error.changed',
  INVALID_APPROVAL_THRESHOLD: 'settings.error.threshold',
  VALIDATION_FAILED: 'settings.error.threshold',
};

/**
 * The company's settings (#10): today, the purchase approval threshold. Configuration the admin
 * maintains (ADR-0008); every change is audited.
 */
export function CompanySettingsPage() {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: qk.companySettings, queryFn: getCompanySettings });
  // Kept here: saving remounts the form at the new revision.
  const [savedAmount, setSavedAmount] = useState<string | null>(null);

  return (
    <section className="page" aria-labelledby="settings-title">
      <div className="page__header">
        <div>
          <h1 id="settings-title">{t('settings.title')}</h1>
          <p className="muted">{t('settings.intro')}</p>
        </div>
      </div>
      {settings.isPending && (
        <p className="muted" role="status">
          {t('settings.loading')}
        </p>
      )}
      {settings.isError && <ErrorCallout error={settings.error} />}
      {savedAmount && (
        <p className="callout callout--success" role="status">
          {t('settings.saved', { amount: groupDigits(savedAmount) })}
        </p>
      )}
      {settings.data && (
        <ThresholdForm
          key={settings.data.revision}
          settings={settings.data}
          onSaved={setSavedAmount}
          onEdit={() => setSavedAmount(null)}
        />
      )}
    </section>
  );
}

function ThresholdForm({
  settings,
  onSaved,
  onEdit,
}: {
  settings: CompanySettings;
  onSaved: (amount: string) => void;
  onEdit: () => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState(settings.purchaseApprovalThreshold);
  const save = useMutation({
    mutationFn: () => updateCompanySettings(settings.revision, threshold.trim()),
    onSuccess: async (result) => {
      queryClient.setQueryData(qk.companySettings, result);
      await queryClient.invalidateQueries({ queryKey: qk.purchaseOrders });
      onSaved(result.purchaseApprovalThreshold);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    onEdit();
    save.mutate();
  };

  return (
    <form className="panel" onSubmit={onSubmit} aria-labelledby="threshold-title">
      <h2 id="threshold-title">{t('settings.threshold.title')}</h2>
      <p className="subtle">{t('settings.threshold.hint')}</p>
      <div className="field">
        <label htmlFor="settings-threshold">{t('settings.threshold.label')}</label>
        <input
          id="settings-threshold"
          inputMode="decimal"
          autoComplete="off"
          required
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </div>
      <p className="subtle">
        {settings.updated
          ? t('settings.updated', {
              name: settings.updated.by.displayName,
              time: formatDateTime(settings.updated.at, language),
            })
          : t('settings.neverSaved')}
      </p>
      {save.isError && <ErrorCallout error={save.error} messages={ERRORS} />}
      <div className="actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </form>
  );
}

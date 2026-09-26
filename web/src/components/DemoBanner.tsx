// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query';
import { qk } from '@/app/query-client';
import { fetchInstallation } from '@/features/installation/installation.api';
import { useI18n } from '@/i18n/useI18n';

/**
 * On every screen of a demo installation (ERP_DEMO=1), signed in or not: the demo
 * accounts' passwords are published, so nobody should mistake it for a real one (#5).
 * Shows nothing while it is asking, or if the API cannot say.
 */
export function DemoBanner() {
  const { t } = useI18n();
  const installation = useQuery({
    queryKey: qk.installation,
    queryFn: fetchInstallation,
    // Fixed for the life of the API process; a restart with another flag is a new load.
    staleTime: Infinity,
    retry: false,
  });
  if (!installation.data?.demo) return null;

  return (
    <aside className="demo-banner" aria-labelledby="demo-banner-title">
      <strong id="demo-banner-title">{t('demo.banner.title')}</strong>{' '}
      <span>{t('demo.banner.body')}</span>
      {/* The public demo (#41) has no server at all; any other build compiles this away. */}
      {__ERP_DEMO__ && <span> {t('demo.banner.inBrowser')}</span>}
    </aside>
  );
}

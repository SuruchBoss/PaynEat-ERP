// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n/useI18n';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <section className="page" aria-labelledby="not-found-title">
      <h1 id="not-found-title">{t('notFound.title')}</h1>
      <p className="muted">{t('notFound.body')}</p>
      <p>
        <Link to="/">{t('notFound.back')}</Link>
      </p>
    </section>
  );
}

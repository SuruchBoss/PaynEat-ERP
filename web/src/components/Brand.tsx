// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { useI18n } from '@/i18n/useI18n';

/**
 * The PaynEat ERP mark: a lot tag — the label tied to a crate that makes every lot
 * traceable — with three ledger lines of falling length (the oldest lot goes first, FEFO).
 * Drawn inline so it takes the theme's colours: rust on the workspace, the rail's accent on
 * the dark rail. Master files, the wordmark in outline and usage notes: `docs/brand/`.
 */
const TAG =
  'M22 8h30a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H22a4 4 0 0 1-2.9-1.24L6.2 36.9a7 7 0 0 1 0-9.8' +
  'L19.1 9.24A4 4 0 0 1 22 8Zm-3.5 28a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <path className="brand-mark__tag" fillRule="evenodd" d={TAG} />
      <path
        className="brand-mark__lines"
        fill="none"
        strokeWidth={4.4}
        strokeLinecap="round"
        d="M29 22H50M29 32H45M29 42H39"
      />
    </svg>
  );
}

/** The mark with the product's name: "PaynEat" strong, "ERP" quieter. */
export function Brand({ size = 28, className }: { size?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={className ? `brand ${className}` : 'brand'}>
      <BrandMark size={size} />
      <span className="brand__name">
        {t('app.name.product')} <span className="brand__module">{t('app.name.module')}</span>
      </span>
    </span>
  );
}

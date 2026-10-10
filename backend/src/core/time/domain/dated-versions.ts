// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Dated versions (ADR-0023): a version is in force from its effective-from business date
 * until the next version of the same subject starts. There is no end date to keep in step,
 * so two versions of one subject can never cover the same day unless they start on it,
 * and that is refused. Recipes (#16) and production BOMs (#12) follow these rules. No clock
 * here: callers pass today's business date.
 */
import { addDays, compareDates } from './business-date';

export interface Dated {
  /** ISO `YYYY-MM-DD`, a business date in the company's time zone (ADR-0018). */
  effectiveFrom: string;
}

/**
 * The version in force on `date`: the one with the latest effective-from on or before it.
 * Null when the first version starts later, or there is none. The input order does not
 * matter.
 */
export function versionInEffect<T extends Dated>(versions: readonly T[], date: string): T | null {
  let found: T | null = null;
  for (const version of versions) {
    if (compareDates(version.effectiveFrom, date) > 0) continue;
    if (!found || compareDates(version.effectiveFrom, found.effectiveFrom) > 0) found = version;
  }
  return found;
}

/** Whether a version has taken effect: from then on it is history and never changes. */
export function hasTakenEffect(version: Dated, today: string): boolean {
  return compareDates(version.effectiveFrom, today) <= 0;
}

export type NewVersionProblem =
  /** Another version of this subject starts on that day: two would be in force at once. */
  | { reason: 'overlap' }
  /**
   * Earlier than `earliest`. A version never starts in the past; once a version is in
   * force, a new one starts tomorrow at the earliest, so no day that has begun changes
   * version after work may already have been done under it.
   */
  | { reason: 'too_early'; earliest: string };

/** Why a new version starting on `effectiveFrom` is refused, or null when it is allowed. */
export function newVersionProblem(
  existing: readonly Dated[],
  effectiveFrom: string,
  today: string,
): NewVersionProblem | null {
  const earliest = versionInEffect(existing, today) ? addDays(today, 1) : today;
  if (compareDates(effectiveFrom, earliest) < 0) return { reason: 'too_early', earliest };
  if (existing.some((v) => v.effectiveFrom === effectiveFrom)) return { reason: 'overlap' };
  return null;
}

/** Where a version stands on `today`: in force, not yet started, or replaced by a later one. */
export type VersionStatus = 'current' | 'scheduled' | 'past';

export function versionStatus<T extends Dated>(
  version: T,
  versions: readonly T[],
  today: string,
): VersionStatus {
  if (!hasTakenEffect(version, today)) return 'scheduled';
  const current = versionInEffect(versions, today);
  return current && current.effectiveFrom === version.effectiveFrom ? 'current' : 'past';
}

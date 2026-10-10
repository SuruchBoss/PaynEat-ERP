// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/modules/jobs/domain/job-locks.ts and
// backend/src/core/prisma/advisory-lock.ts), see NOTICE.

/**
 * The namespace of every advisory lock the ERP takes: `0x504E4552` spells `PNER`, recognisable in
 * `pg_locks.classid`, so the ERP never collides with another application sharing the database.
 */
export const JOB_LOCK_NAMESPACE = 0x504e4552;

/**
 * Scheduled work that runs on one instance at a time, and the lock id each holds. Written out by
 * hand, never hashed, so `pg_locks` shows a number one can look up. **Never renumber or reuse an
 * id**: during a rolling deploy two versions only agree on who holds what while an id means the
 * same job in both.
 */
export const JOB_LOCKS = {
  /** Turning received POS sales into branch consumption (#17). */
  'branch-consumption': 1,
} as const;

export type JobName = keyof typeof JOB_LOCKS;

export function lockIdFor(name: JobName): number {
  return JOB_LOCKS[name];
}

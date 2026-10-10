// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { newVersionProblem, versionInEffect, versionStatus } from './dated-versions';

describe('dated versions', () => {
  const versions = [
    { effectiveFrom: '2026-10-20', n: 3 },
    { effectiveFrom: '2026-09-01', n: 1 },
    { effectiveFrom: '2026-10-01', n: 2 },
  ];

  it('finds the version in force on a day, whatever the input order', () => {
    expect(versionInEffect(versions, '2026-08-31')).toBeNull();
    expect(versionInEffect(versions, '2026-09-01')?.n).toBe(1);
    expect(versionInEffect(versions, '2026-10-19')?.n).toBe(2);
    expect(versionInEffect(versions, '2026-10-20')?.n).toBe(3);
  });

  it('tells current, scheduled and past versions apart', () => {
    const [third, first, second] = versions;
    expect(versionStatus(first, versions, '2026-10-10')).toBe('past');
    expect(versionStatus(second, versions, '2026-10-10')).toBe('current');
    expect(versionStatus(third, versions, '2026-10-10')).toBe('scheduled');
  });

  it('lets a first version start today, a later one tomorrow at the earliest', () => {
    expect(newVersionProblem([], '2026-10-10', '2026-10-10')).toBeNull();
    expect(newVersionProblem([], '2026-10-09', '2026-10-10')).toEqual({
      reason: 'too_early',
      earliest: '2026-10-10',
    });
    expect(newVersionProblem(versions, '2026-10-10', '2026-10-10')).toEqual({
      reason: 'too_early',
      earliest: '2026-10-11',
    });
    expect(newVersionProblem(versions, '2026-10-20', '2026-10-10')).toEqual({ reason: 'overlap' });
    expect(newVersionProblem(versions, '2026-10-21', '2026-10-10')).toBeNull();
  });
});

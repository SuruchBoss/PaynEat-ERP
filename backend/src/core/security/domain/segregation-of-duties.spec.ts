// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { segregationProblem } from './segregation-of-duties';

describe('segregation of duties (ADR-0008)', () => {
  it('refuses the creator, whatever roles they hold, and lets anyone else approve', () => {
    expect(segregationProblem({ createdById: 'u-plant' }, 'u-plant')).toBe('self_approval');
    expect(segregationProblem({ createdById: 'u-plant' }, 'u-finance')).toBeNull();
  });
});

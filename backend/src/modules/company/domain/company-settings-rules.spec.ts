// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { thresholdProblem } from './company-settings-rules';

describe('company settings rules', () => {
  it.each([
    ['20000', null],
    ['0', null],
    ['20000.50', null],
    ['', 'THRESHOLD_NOT_A_NUMBER'],
    ['1e5', 'THRESHOLD_NOT_A_NUMBER'],
    ['-1', 'THRESHOLD_NEGATIVE'],
    ['1.005', 'THRESHOLD_TOO_PRECISE'],
    ['100000000000000000', 'THRESHOLD_TOO_LARGE'],
  ] as const)('a purchase approval threshold of %j: %s', (text, problem) => {
    expect(thresholdProblem(text)).toBe(problem);
  });
});

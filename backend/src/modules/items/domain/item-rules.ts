// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules an item's purchase units follow (ADR-0005): each names a known unit other
 * than the base unit, at most once, with a valid conversion factor. Pure, so the rules
 * are tested without a database and every problem is reported at once.
 */
import { factorProblem, normaliseFactor, type FactorProblem } from './unit-conversion';

export interface PurchaseUnitInput {
  unitCode: string;
  factor: string;
}

export type PurchaseUnitProblem =
  FactorProblem | 'UNKNOWN_UNIT' | 'SAME_AS_BASE_UNIT' | 'DUPLICATE';

export interface PurchaseUnitIssue {
  /** Position in the submitted list, so the console can mark the row. */
  index: number;
  unitCode: string;
  problem: PurchaseUnitProblem;
}

/** Every problem in the list, in order; empty when it is valid. */
export function purchaseUnitIssues(
  baseUnitCode: string,
  purchaseUnits: readonly PurchaseUnitInput[],
  knownUnitCodes: ReadonlySet<string>,
): PurchaseUnitIssue[] {
  const issues: PurchaseUnitIssue[] = [];
  const seen = new Set<string>();
  purchaseUnits.forEach(({ unitCode, factor }, index) => {
    const issue = (problem: PurchaseUnitProblem) => issues.push({ index, unitCode, problem });
    if (!knownUnitCodes.has(unitCode)) issue('UNKNOWN_UNIT');
    else if (unitCode === baseUnitCode) issue('SAME_AS_BASE_UNIT');
    else if (seen.has(unitCode)) issue('DUPLICATE');
    seen.add(unitCode);

    const problem = factorProblem(factor);
    if (problem) issue(problem);
  });
  return issues;
}

/** The list as stored: factors in shortest form, ordered by unit code. Assumes it is valid. */
export function normalisePurchaseUnits(
  purchaseUnits: readonly PurchaseUnitInput[],
): PurchaseUnitInput[] {
  return purchaseUnits
    .map(({ unitCode, factor }) => ({ unitCode, factor: normaliseFactor(factor) }))
    .sort((a, b) => a.unitCode.localeCompare(b.unitCode));
}

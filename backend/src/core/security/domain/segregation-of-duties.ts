// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * Nobody approves a document they created, whatever roles they hold (ADR-0008 decision 3). One
 * rule for every document that is approved: stock adjustments (#8) and purchase orders (#10). The
 * services call it on every approval, the database refuses it again, and the console only
 * mirrors it.
 */
export function segregationProblem(
  document: { createdById: string },
  approverId: string,
): 'self_approval' | null {
  return document.createdById === approverId ? 'self_approval' : null;
}

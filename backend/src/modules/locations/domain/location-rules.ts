// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The rules of locations (#6; docs/GLOSSARY.md "Location code", ADR-0001, ADR-0007,
 * ADR-0011). Pure, so each rule is tested without a database and the console, the API
 * and the seed agree on them.
 */

/** The ecosystem-wide shape, the same in the ERP, PaynEat POS and Cwork. */
export const LOCATION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

export type LocationCodeProblem =
  'TOO_SHORT' | 'TOO_LONG' | 'BAD_FIRST_CHARACTER' | 'BAD_CHARACTER';

/** What is wrong with a code a person typed (after `normaliseLocationCode`), or null. */
export function locationCodeProblem(code: string): LocationCodeProblem | null {
  if (code.length < 2) return 'TOO_SHORT';
  if (code.length > 32) return 'TOO_LONG';
  if (!/^[A-Z0-9]/.test(code)) return 'BAD_FIRST_CHARACTER';
  if (!/^[A-Z0-9-]+$/.test(code)) return 'BAD_CHARACTER';
  return null;
}

/** Codes are compared and stored in capitals, without surrounding spaces. */
export function normaliseLocationCode(input: string): string {
  return input.trim().toUpperCase();
}

/** The types a person creates; in-transit is the system's, subcontractor is reserved. */
export const CREATABLE_TYPES = ['plant', 'warehouse', 'branch'] as const;
export type CreatableType = (typeof CREATABLE_TYPES)[number];
export type LocationTypeName = CreatableType | 'in_transit' | 'subcontractor';

/** Stock dispatched from these goes through an in-transit location of their own (ADR-0007). */
export function shipsThroughInTransit(type: LocationTypeName): boolean {
  return type === 'plant' || type === 'warehouse';
}

/**
 * The code of the in-transit location of `originCode`. The colon is a character no
 * person can type into a location code, so it can never collide with a real site's.
 */
export function inTransitCode(originCode: string): string {
  return `IN-TRANSIT:${originCode}`;
}

export type CreateProblem = 'TYPE_SYSTEM_MANAGED' | 'TYPE_RESERVED';

/** Why a person may not create a location of this type, or null. */
export function createProblem(type: LocationTypeName): CreateProblem | null {
  if (type === 'in_transit') return 'TYPE_SYSTEM_MANAGED';
  if (type === 'subcontractor') return 'TYPE_RESERVED';
  return null;
}

export interface LocationState {
  type: LocationTypeName;
  active: boolean;
  /** Set once the code is in use: a posted document or a POS pull named it. */
  firstUsedAt: Date | null;
  supersededById: string | null;
}

export interface LocationChange {
  codeChanges: boolean;
  /** `true` or `false` when the change sets it; undefined when it leaves it alone. */
  active?: boolean;
}

export type EditProblem = 'SYSTEM_MANAGED' | 'CODE_IN_USE' | 'SUPERSEDED';

/** Why this change may not be made to this location, or null. */
export function editProblem(location: LocationState, change: LocationChange): EditProblem | null {
  if (location.type === 'in_transit') return 'SYSTEM_MANAGED';
  if (change.codeChanges && location.firstUsedAt) return 'CODE_IN_USE';
  // A superseded location stays out of use: its replacement took over its role.
  if (change.active === true && location.supersededById) return 'SUPERSEDED';
  return null;
}

export interface Replacement {
  id: string;
  type: LocationTypeName;
  active: boolean;
  supersededById: string | null;
}

export type SupersedeProblem =
  | 'SYSTEM_MANAGED'
  | 'ALREADY_SUPERSEDED'
  | 'SAME_LOCATION'
  | 'DIFFERENT_TYPE'
  | 'REPLACEMENT_INACTIVE';

/**
 * Why `location` may not be superseded by `replacement`, or null. The fix for a wrong
 * code already in use: a new location of the same type takes over, and the old one is
 * deactivated with a link to it.
 */
export function supersedeProblem(
  location: LocationState & { id: string },
  replacement: Replacement,
): SupersedeProblem | null {
  if (location.type === 'in_transit' || replacement.type === 'in_transit') return 'SYSTEM_MANAGED';
  if (location.supersededById) return 'ALREADY_SUPERSEDED';
  if (replacement.id === location.id) return 'SAME_LOCATION';
  if (replacement.type !== location.type) return 'DIFFERENT_TYPE';
  if (!replacement.active || replacement.supersededById) return 'REPLACEMENT_INACTIVE';
  return null;
}

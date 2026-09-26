// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  createProblem,
  editProblem,
  inTransitCode,
  LOCATION_CODE_PATTERN,
  locationCodeProblem,
  normaliseLocationCode,
  shipsThroughInTransit,
  supersedeProblem,
  type LocationState,
} from './location-rules';

const branch = (overrides: Partial<LocationState> = {}): LocationState & { id: string } => ({
  id: 'old',
  type: 'branch',
  active: true,
  firstUsedAt: null,
  supersededById: null,
  ...overrides,
});

describe('location codes', () => {
  it.each(['BR-SILOM', 'PLANT-01', 'B1', '9-TO-5', 'A'.repeat(32)])('accepts %s', (code) => {
    expect(locationCodeProblem(code)).toBeNull();
    expect(LOCATION_CODE_PATTERN.test(code)).toBe(true);
  });

  it.each([
    ['B', 'TOO_SHORT'],
    ['', 'TOO_SHORT'],
    ['A'.repeat(33), 'TOO_LONG'],
    ['-SILOM', 'BAD_FIRST_CHARACTER'],
    ['BR SILOM', 'BAD_CHARACTER'],
    ['BR_SILOM', 'BAD_CHARACTER'],
    ['สาขา-1', 'BAD_FIRST_CHARACTER'],
    ['br-silom', 'BAD_FIRST_CHARACTER'],
    ['BR-สีลม', 'BAD_CHARACTER'],
    ['IN-TRANSIT:PLANT-01', 'BAD_CHARACTER'],
  ])('refuses %j (%s)', (code, problem) => {
    expect(locationCodeProblem(code)).toBe(problem);
    expect(LOCATION_CODE_PATTERN.test(code)).toBe(false);
  });

  it('agrees with the pattern the database and the other systems use', () => {
    for (const code of ['AB', 'A-', '0-0-0', 'Z'.repeat(31) + '-']) {
      expect(locationCodeProblem(code) === null).toBe(LOCATION_CODE_PATTERN.test(code));
    }
  });

  it('normalises what a person types', () => {
    expect(normaliseLocationCode('  br-silom ')).toBe('BR-SILOM');
  });
});

describe('in-transit locations', () => {
  it('belong to plants and warehouses, not branches', () => {
    expect(shipsThroughInTransit('plant')).toBe(true);
    expect(shipsThroughInTransit('warehouse')).toBe(true);
    expect(shipsThroughInTransit('branch')).toBe(false);
  });

  it('take a code no person can type, so it never collides with a real site', () => {
    const code = inTransitCode('PLANT-01');
    expect(code).toBe('IN-TRANSIT:PLANT-01');
    expect(locationCodeProblem(code)).not.toBeNull();
  });
});

describe('creating a location', () => {
  it('is open for plants, warehouses and branches only', () => {
    expect(createProblem('plant')).toBeNull();
    expect(createProblem('warehouse')).toBeNull();
    expect(createProblem('branch')).toBeNull();
    expect(createProblem('in_transit')).toBe('TYPE_SYSTEM_MANAGED');
    expect(createProblem('subcontractor')).toBe('TYPE_RESERVED');
  });
});

describe('editing a location', () => {
  it('allows correcting the code until its first use, and never after', () => {
    expect(editProblem(branch(), { codeChanges: true })).toBeNull();
    expect(editProblem(branch({ firstUsedAt: new Date() }), { codeChanges: true })).toBe(
      'CODE_IN_USE',
    );
    // Its names and active flag still change after first use.
    expect(editProblem(branch({ firstUsedAt: new Date() }), { codeChanges: false })).toBeNull();
  });

  it('never touches an in-transit location', () => {
    expect(editProblem(branch({ type: 'in_transit' }), { codeChanges: false })).toBe(
      'SYSTEM_MANAGED',
    );
  });

  it('keeps a superseded location out of use', () => {
    const superseded = branch({ active: false, supersededById: 'new' });
    expect(editProblem(superseded, { codeChanges: false, active: true })).toBe('SUPERSEDED');
    expect(editProblem(superseded, { codeChanges: false })).toBeNull();
  });
});

describe('superseding a location', () => {
  const replacement = { id: 'new', type: 'branch' as const, active: true, supersededById: null };

  it('replaces it with an active location of the same type', () => {
    expect(supersedeProblem(branch(), replacement)).toBeNull();
  });

  it.each([
    ['an in-transit location', branch({ type: 'in_transit' }), replacement, 'SYSTEM_MANAGED'],
    ['one already superseded', branch({ supersededById: 'x' }), replacement, 'ALREADY_SUPERSEDED'],
    ['by itself', branch(), { ...replacement, id: 'old' }, 'SAME_LOCATION'],
    ['by another type', branch(), { ...replacement, type: 'plant' as const }, 'DIFFERENT_TYPE'],
    ['by an inactive one', branch(), { ...replacement, active: false }, 'REPLACEMENT_INACTIVE'],
    [
      'by one superseded itself',
      branch(),
      { ...replacement, supersededById: 'y' },
      'REPLACEMENT_INACTIVE',
    ],
  ])('refuses %s', (_name, location, by, problem) => {
    expect(supersedeProblem(location, by)).toBe(problem);
  });
});

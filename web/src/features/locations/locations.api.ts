// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Locations (backend `modules/locations/locations.controller.ts`).
import { api } from '@/lib/api-client';

export type LocationType = 'plant' | 'warehouse' | 'branch' | 'in_transit' | 'subcontractor';
/** The types a person creates; in-transit is the system's, subcontractor is reserved. */
export const CREATABLE_TYPES = ['plant', 'warehouse', 'branch'] as const;
export type CreatableType = (typeof CREATABLE_TYPES)[number];

export interface LocationRef {
  id: string;
  code: string;
}

export interface LocationView {
  id: string;
  code: string;
  type: LocationType;
  nameTh: string;
  nameEn: string;
  active: boolean;
  origin: LocationRef | null;
  inTransit: LocationRef | null;
  supersededBy: LocationRef | null;
  /** Set once a document or a POS pull used the code: it can no longer be corrected. */
  firstUsedAt: string | null;
  firstUse: string | null;
  revision: number;
  masterDataVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewLocation {
  code: string;
  type: CreatableType;
  nameTh: string;
  nameEn: string;
}

export interface LocationChange {
  revision: number;
  code?: string;
  nameTh?: string;
  nameEn?: string;
  active?: boolean;
}

/** Every location, active or not: the list filters on screen. */
export const listLocations = () =>
  api.get<LocationView[]>('/locations', { query: { status: 'all' } });

export const createLocation = (location: NewLocation) =>
  api.post<LocationView>('/locations', location);

export const updateLocation = (id: string, change: LocationChange) =>
  api.patch<LocationView>(`/locations/${encodeURIComponent(id)}`, change);

export const supersedeLocation = (id: string, revision: number, byLocationId: string) =>
  api.post<LocationView>(`/locations/${encodeURIComponent(id)}/supersede`, {
    revision,
    byLocationId,
  });

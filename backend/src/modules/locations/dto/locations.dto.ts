// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const LOCATION_TYPES = [
  'plant',
  'warehouse',
  'branch',
  'in_transit',
  'subcontractor',
] as const;
export type LocationTypeName = (typeof LOCATION_TYPES)[number];

export class CreateLocationDto {
  /** Checked against the ecosystem format by the service, which says what is wrong. */
  @IsString()
  @MaxLength(64)
  code!: string;

  /** Any type is accepted here, so the service can say why in-transit or subcontractor is refused. */
  @IsIn(LOCATION_TYPES)
  type!: LocationTypeName;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn!: string;
}

/** Only the fields that change, with the revision the editor was opened at. The type never changes. */
export class UpdateLocationDto {
  @IsInt()
  @Min(1)
  revision!: number;

  /** Correctable until the location is first used (docs/GLOSSARY.md "Location code"). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameTh?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimmed)
  nameEn?: string;

  /** Deactivated, never deleted; `true` brings one back. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Replace a location whose wrong code is already in use by another of the same type. */
export class SupersedeLocationDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsUUID()
  byLocationId!: string;
}

export class LocationsQueryDto {
  @IsOptional()
  @IsIn(LOCATION_TYPES)
  type?: LocationTypeName;

  /** `active` (the default), `inactive` or `all`. */
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'active';
}

export interface LocationRef {
  id: string;
  code: string;
}

export interface LocationView {
  id: string;
  code: string;
  type: LocationTypeName;
  nameTh: string;
  nameEn: string;
  active: boolean;
  /** In-transit only: the plant or warehouse whose dispatched stock it holds. */
  origin: LocationRef | null;
  /** Plants and warehouses: their in-transit location. */
  inTransit: LocationRef | null;
  supersededBy: LocationRef | null;
  /** When the code became fixed, and by what; null while it can still be corrected. */
  firstUsedAt: Date | null;
  firstUse: string | null;
  /** Sent back with an edit, so an edit made on a stale screen is refused. */
  revision: number;
  /** Branches only: the master data version of their latest change. */
  masterDataVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}

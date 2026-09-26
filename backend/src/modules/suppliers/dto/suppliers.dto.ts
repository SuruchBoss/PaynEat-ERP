// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** The same shape as item and location codes. */
export const SUPPLIER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An optional text field sent empty means "none". */
const trimmedOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

class SupplierContactDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(120)
  @Transform(trimmedOrNull)
  contactName?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  @Transform(trimmedOrNull)
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => {
    const v = trimmedOrNull({ value });
    return typeof v === 'string' ? v.toLowerCase() : v;
  })
  email?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  @Transform(trimmedOrNull)
  address?: string | null;
}

export class CreateSupplierDto extends SupplierContactDto {
  /** Upper-cased on the way in; fixed once the supplier exists. */
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(SUPPLIER_CODE_PATTERN, {
    message:
      'code must be 2–32 capital letters, digits or hyphens, starting with a letter or digit',
  })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(trimmed)
  name!: string;

  /** 13 digits; spaces and dashes are ignored. The check digit is verified by the service. */
  @IsString()
  @MaxLength(32)
  taxId!: string;
}

/** Only the fields that change, with the revision the editor was opened at. */
export class UpdateSupplierDto extends SupplierContactDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(trimmed)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  taxId?: string;

  /** Deactivated, never deleted; `true` brings one back. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SuppliersQueryDto {
  /** `active` (the default), `inactive` or `all`. */
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'active';
}

export interface SupplierView {
  id: string;
  code: string;
  name: string;
  taxId: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

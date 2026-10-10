// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Who did something, as people see them. */
export interface PersonRef {
  id: string;
  displayName: string;
}

/** The company's settings as the console shows them. */
export interface CompanySettingsView {
  /** Money with two decimals, as a string (ADR-0019): "20000.00". */
  purchaseApprovalThreshold: string;
  /**
   * How far after its receipt a sale may be dated before it is held for a person (#17,
   * ADR-0030): a POS clock a little fast is normal, a day ahead is not. Minutes; 10 by default.
   */
  saleTimeAheadToleranceMinutes: number;
  /** 0 until the admin first saves the settings: the defaults apply until then. */
  revision: number;
  updated: { by: PersonRef; at: Date } | null;
}

/** A change, made from the revision the admin opened. */
export class UpdateCompanySettingsDto {
  @IsInt()
  @Min(0)
  revision!: number;

  /** A decimal string, never a JSON number: "20000" or "20000.00". */
  @IsString()
  @MaxLength(24)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  purchaseApprovalThreshold!: string;

  /** Left out, it stays as it is. At most a day. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  saleTimeAheadToleranceMinutes?: number;
}

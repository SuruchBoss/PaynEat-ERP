// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** `GET /master-data/changes` (contracts/pos/v1/openapi.yaml `getMasterDataChanges`). */
export class ChangesQueryDto {
  /** The last version the caller has applied; 0 (the default) asks for everything. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  since = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  limit = 500;
}

/** An administrator registering a POS instance. Codes are stored in capitals. */
export class RegisterPosInstanceDto {
  @IsString()
  @MaxLength(32)
  @Transform(upper)
  code!: string;

  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  name!: string;

  /** The branches it sells for, by ecosystem location code. */
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
      : value,
  )
  branchCodes!: string[];
}

export interface PosBranchView {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  active: boolean;
}

export interface PosInstanceView {
  id: string;
  code: string;
  name: string;
  createdAt: Date;
  createdBy: { id: string; displayName: string };
  branches: PosBranchView[];
  /** The credential in use, if any: never the credential itself, only when and by whom. */
  credential: { issuedAt: Date; issuedBy: { id: string; displayName: string } } | null;
  /** The last successful master-data pull. */
  lastPullAt: Date | null;
}

/** Registration or a new credential: the only time the credential is ever shown. */
export interface IssuedCredentialView {
  instance: PosInstanceView;
  credential: string;
}

/** contracts/pos/v1/pos-instance.schema.json */
export interface ContractInstanceView {
  code: string;
  name: string;
  contractVersion: string;
  branches: Array<{ code: string; nameTh: string; nameEn: string; active: boolean }>;
}

/** contracts/pos/v1/sales-event-receipt.schema.json */
export interface SalesEventReceipt {
  idempotencyKey: string;
  status: 'received' | 'processed' | 'failed';
  duplicate: boolean;
  receivedAt: Date;
}

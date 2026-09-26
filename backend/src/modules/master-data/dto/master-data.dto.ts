// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

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

export interface MasterDataChangeView {
  version: number;
  /** `item` today; locations, menu items and recipes reuse the same log later. */
  entityType: string;
  entityId: string;
  entityCode: string;
  action: 'created' | 'updated';
  /** The whole record as it stood after this change, so a mirror can simply overwrite. */
  data: unknown;
  changedAt: Date;
}

export interface MasterDataChangesView {
  /** The company-wide master data version when this page was read. */
  latestVersion: number;
  /** Every change after `since`, in version order, at most `limit` of them. */
  changes: MasterDataChangeView[];
  /** More changes follow: ask again with `since` set to the last version here. */
  hasMore: boolean;
}

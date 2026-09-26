// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/http/pagination.dto.ts), see NOTICE.
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit = 25;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export function pageOf<T>(data: T[], total: number, page: number, limit: number): Page<T> {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return { data, meta: { page, limit, total, totalPages, hasNext: page < totalPages } };
}

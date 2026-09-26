// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { MasterDataController } from './master-data.controller';
import { MasterDataService } from './master-data.service';

/**
 * The company-wide master data version and its append-only change log (#5, ADR-0002).
 * Owns `master_data_version` and `master_data_changes`; a module that owns master data
 * (items today) records every create and update through `MasterDataService`.
 */
@Module({
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}

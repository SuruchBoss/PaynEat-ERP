// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { MasterDataService } from './master-data.service';

/**
 * The company-wide master data version and its append-only change log (#5, ADR-0002).
 * Owns `master_data_version` and `master_data_changes`; a module that owns master data
 * (items today) records every create and update through `MasterDataService`. The pull,
 * `GET /master-data/changes`, is served by the POS integration module (#9), whose contract
 * describes it.
 */
@Module({
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

/**
 * Every place stock can be (#6). Owns `locations`; records every change of a branch
 * through the master data module. Documents and the POS integration mark a location's
 * first use through `LocationsService.markFirstUse`.
 */
@Module({
  imports: [MasterDataModule],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}

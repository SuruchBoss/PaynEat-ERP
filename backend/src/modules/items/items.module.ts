// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

/**
 * The item master (#5). Owns `items`, `item_purchase_units` and the `units` catalogue;
 * records every change through the master data module.
 */
@Module({
  imports: [MasterDataModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}

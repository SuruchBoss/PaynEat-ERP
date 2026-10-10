// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { TransfersModule } from '../transfers/transfers.module';
import { ParLevelsController, RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';

/**
 * Branch requisitions and par levels (#15). Owns `requisitions`, `requisition_lines` and
 * `par_levels`. Writes no stock: reads balances from the ledger, and creates and reads transfers
 * only through the transfers module.
 */
@Module({
  imports: [LedgerModule, ItemsModule, LocationsModule, TransfersModule],
  controllers: [RequisitionsController, ParLevelsController],
  providers: [RequisitionsService],
  exports: [RequisitionsService],
})
export class RequisitionsModule {}

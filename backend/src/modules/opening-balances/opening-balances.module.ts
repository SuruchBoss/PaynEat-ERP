// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { OpeningBalancesController } from './opening-balances.controller';
import { OpeningBalancesService } from './opening-balances.service';

/**
 * Opening balances (#7). Owns `opening_balances` and `opening_balance_lines`; numbers, posts
 * and reverses its documents through the ledger module, which alone writes stock.
 */
@Module({
  imports: [LedgerModule, ItemsModule, LocationsModule],
  controllers: [OpeningBalancesController],
  providers: [OpeningBalancesService],
  exports: [OpeningBalancesService],
})
export class OpeningBalancesModule {}

// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { ProductionBomsModule } from '../production-boms/production-boms.module';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrdersService } from './production-orders.service';

/**
 * Production orders (#13). Owns `production_orders`, `production_order_inputs`,
 * `production_order_picks` and `production_order_outputs`; reads the BOM version it follows
 * through the production-boms module, and numbers, posts and reverses its orders through the
 * ledger module, which alone writes stock and lot genealogy.
 */
@Module({
  imports: [LedgerModule, ItemsModule, LocationsModule, ProductionBomsModule],
  controllers: [ProductionOrdersController],
  providers: [ProductionOrdersService],
  exports: [ProductionOrdersService],
})
export class ProductionOrdersModule {}

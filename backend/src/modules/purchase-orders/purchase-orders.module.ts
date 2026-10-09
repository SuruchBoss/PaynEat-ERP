// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { ItemsModule } from '../items/items.module';
import { LocationsModule } from '../locations/locations.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Purchase orders (#10). Owns `purchase_orders` and `purchase_order_lines`. Commits money, not
 * stock: it does not use the ledger module.
 */
@Module({
  imports: [ItemsModule, LocationsModule, SuppliersModule, CompanyModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}

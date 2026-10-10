// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { GoodsReceiptsController, SupplierReturnsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';

/**
 * Goods receipts and returns to supplier (#11). Owns `goods_receipts`, `goods_receipt_lines`,
 * `supplier_returns` and `supplier_return_lines`; numbers and posts its receipts through the
 * ledger module, which alone writes stock, and records what arrived through the purchase-orders
 * module, which alone writes orders.
 */
@Module({
  imports: [LedgerModule, ItemsModule, LocationsModule, SuppliersModule, PurchaseOrdersModule],
  controllers: [GoodsReceiptsController, SupplierReturnsController],
  providers: [GoodsReceiptsService],
  exports: [GoodsReceiptsService],
})
export class GoodsReceiptsModule {}

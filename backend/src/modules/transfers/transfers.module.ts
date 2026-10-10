// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { TransferReceiptsController, TransfersController } from './transfers.controller';
import { TransferReceiptsService } from './transfer-receipts.service';
import { TransfersService } from './transfers.service';

/**
 * Transfers and transfer receipts (#14). Owns `transfers`, `transfer_lines`, `transfer_picks`,
 * `transfer_receipts` and `transfer_receipt_lines`; numbers, posts and moves stock only through
 * the ledger module, which alone writes stock.
 */
@Module({
  imports: [LedgerModule, ItemsModule, LocationsModule],
  controllers: [TransfersController, TransferReceiptsController],
  providers: [TransfersService, TransferReceiptsService],
  exports: [TransfersService],
})
export class TransfersModule {}

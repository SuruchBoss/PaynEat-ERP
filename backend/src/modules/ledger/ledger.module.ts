// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LocationsModule } from '../locations/locations.module';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

/**
 * The stock ledger (#7). Owns `stock_documents`, `lots`, `ledger_entries` and
 * `stock_balances`, and is the only module that writes the last three — in raw SQL, inside
 * one transaction per posting (`npm run check:architecture` rule `ledger-writes`). Document
 * types number, post and reverse their documents through `LedgerService`.
 */
@Module({
  imports: [ItemsModule, LocationsModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}

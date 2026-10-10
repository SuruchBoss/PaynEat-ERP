// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ProductionBomsController } from './production-boms.controller';
import { ProductionBomsService } from './production-boms.service';

/**
 * Production BOMs (#12). Owns `production_boms`, `production_bom_versions` and
 * `production_bom_lines`. Production orders (#13) read the version in force through this
 * module's service.
 */
@Module({
  imports: [ItemsModule, LedgerModule],
  controllers: [ProductionBomsController],
  providers: [ProductionBomsService],
  exports: [ProductionBomsService],
})
export class ProductionBomsModule {}

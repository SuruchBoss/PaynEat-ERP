// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { JobLockService } from '../../core/jobs/job-lock.service';
import { AuthModule } from '../auth/auth.module';
import { CompanyModule } from '../company/company.module';
import { ItemsModule } from '../items/items.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { MenuModule } from '../menu/menu.module';
import { PosIntegrationModule } from '../pos-integration/pos-integration.module';
import { BranchConsumptionController } from './branch-consumption.controller';
import { BranchConsumptionService } from './branch-consumption.service';

/**
 * Branch consumption (#17, ADR-0030). Owns `branch_consumptions`, `branch_consumption_lines` and
 * `sales_event_processing`. Reads sales events through the POS integration module, recipes
 * through the menu module, and writes stock only through the ledger.
 */
@Module({
  imports: [
    AuthModule,
    CompanyModule,
    ItemsModule,
    LedgerModule,
    LocationsModule,
    MenuModule,
    PosIntegrationModule,
  ],
  controllers: [BranchConsumptionController],
  providers: [BranchConsumptionService, JobLockService],
  exports: [BranchConsumptionService],
})
export class BranchConsumptionModule {}

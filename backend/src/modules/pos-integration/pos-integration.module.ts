// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PosFacingController } from './pos-facing.controller';
import { PosInstancesController } from './pos-instances.controller';
import { PosInstancesService } from './pos-instances.service';
import { PosIntegrationService } from './pos-integration.service';
import { SalesEventsService } from './sales-events.service';

/**
 * The POS integration (#9, ADR-0002, contracts/). Owns `pos_instances`, `pos_instance_branches`,
 * `pos_credentials` and `sales_events`; serves the master-data pull from the master-data module's
 * change log, and names branches through the locations module.
 */
@Module({
  imports: [LocationsModule, MasterDataModule],
  controllers: [PosInstancesController, PosFacingController],
  providers: [PosInstancesService, SalesEventsService, PosIntegrationService],
  exports: [PosInstancesService, SalesEventsService, PosIntegrationService],
})
export class PosIntegrationModule {}

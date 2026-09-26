// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Controller, Get, Query } from '@nestjs/common';
import { ChangesQueryDto, type MasterDataChangesView } from './dto/master-data.dto';
import { MasterDataService } from './master-data.service';

@Controller('master-data')
export class MasterDataController {
  constructor(private readonly masterData: MasterDataService) {}

  /**
   * Every master data change after `since`, in version order, with the latest version.
   * Open to any signed-in user; POS instances will pull it with their own credential.
   */
  @Get('changes')
  changes(@Query() query: ChangesQueryDto): Promise<MasterDataChangesView> {
    return this.masterData.changesSince(query.since, query.limit);
  }
}

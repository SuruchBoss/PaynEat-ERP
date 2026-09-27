// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Body, Controller, Get, Headers, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../../core/security/current-user';
import { PosCredentialRoute } from '../../core/security/decorators';
import { MasterDataService, type MasterDataChangesView } from '../master-data/master-data.service';
import {
  ChangesQueryDto,
  type ContractInstanceView,
  type SalesEventReceipt,
} from './dto/pos-integration.dto';
import { PosInstancesService } from './pos-instances.service';
import { SalesEventsService } from './sales-events.service';

/**
 * What a PaynEat POS calls, exactly as contracts/pos/v1/openapi.yaml describes it. Each handler
 * authenticates the machine credential itself, so a refused credential is an integration event
 * the ERP logs and counts, not a bare 401 from a guard.
 */
@Controller()
export class PosFacingController {
  constructor(
    private readonly instances: PosInstancesService,
    private readonly salesEvents: SalesEventsService,
    private readonly masterData: MasterDataService,
  ) {}

  @Get('pos/instance')
  @PosCredentialRoute('only')
  instance(@Headers('authorization') authorization?: string): Promise<ContractInstanceView> {
    return this.instances.whoAmI(authorization);
  }

  /**
   * Every master-data change after `since`, in version order. A POS pulls it with its machine
   * credential (the contract); a signed-in person may read it too, which is not recorded as a
   * pull.
   */
  @Get('master-data/changes')
  @PosCredentialRoute('or-session')
  changes(
    @Query() query: ChangesQueryDto,
    @Req() req: Request & { user?: AuthenticatedUser },
  ): Promise<MasterDataChangesView> {
    if (req.user) return this.masterData.changesSince(query.since, query.limit);
    return this.instances.pull(req.headers.authorization, query.since, query.limit);
  }

  /** 201 the first time, 200 for a duplicate: both mean the event is safe in the ERP. */
  @Post('sales-events')
  @PosCredentialRoute('only')
  async salesEvent(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SalesEventReceipt> {
    const { created, receipt } = await this.salesEvents.ingest(authorization, body);
    res.status(created ? 201 : 200);
    return receipt;
  }
}

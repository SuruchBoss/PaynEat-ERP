// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import { BranchConsumptionService } from './branch-consumption.service';
import {
  ConsumptionsQueryDto,
  ProblemsQueryDto,
  UsageQueryDto,
  type BranchConsumptionSummary,
  type BranchConsumptionView,
  type ProcessingRunView,
  type SalesEventProblemView,
  type UsageRowView,
} from './dto/branch-consumption.dto';

/**
 * Branch consumption (#17, ADR-0030). `branch_consumption:read` (branch managers, finance, the
 * admin) reads the consumption documents, the sales events that failed or are held, and the
 * theoretical usage; `sales_event:reprocess` (the admin) asks for a failed or held event to be
 * tried again, and for a run of the processor now rather than at its next interval.
 */
@Controller('branch-consumption')
export class BranchConsumptionController {
  constructor(private readonly consumption: BranchConsumptionService) {}

  @Get()
  @RequirePermissions(Permission.BRANCH_CONSUMPTION_READ)
  list(@Query() query: ConsumptionsQueryDto): Promise<BranchConsumptionSummary[]> {
    return this.consumption.list(query);
  }

  /** Sales events that failed or are held, with whether a re-process can help now. */
  @Get('problems')
  @RequirePermissions(Permission.BRANCH_CONSUMPTION_READ)
  problems(@Query() query: ProblemsQueryDto): Promise<SalesEventProblemView[]> {
    return this.consumption.problems(query);
  }

  /** Theoretical usage per day, branch and item, valued at the lots it came from. */
  @Get('usage')
  @RequirePermissions(Permission.BRANCH_CONSUMPTION_READ)
  usage(@Query() query: UsageQueryDto): Promise<UsageRowView[]> {
    return this.consumption.usage(query);
  }

  @Get(':documentId')
  @RequirePermissions(Permission.BRANCH_CONSUMPTION_READ)
  get(@Param('documentId', ParseUUIDPipe) documentId: string): Promise<BranchConsumptionView> {
    return this.consumption.get(documentId);
  }

  /** Runs the processor now: every event received so far becomes consumption, or a problem. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SALES_EVENT_REPROCESS)
  run(): Promise<ProcessingRunView> {
    return this.consumption.run();
  }

  /**
   * Tries a failed or held event again, as the person asking. Answers with its problem when it
   * still has one, or 204 when it became consumption.
   */
  @Post('sales-events/:id/reprocess')
  @RequirePermissions(Permission.SALES_EVENT_REPROCESS)
  async reprocess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ problem: SalesEventProblemView | null }> {
    return { problem: await this.consumption.reprocess(id, actor) };
  }
}

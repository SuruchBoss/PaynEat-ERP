// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { clientMeta } from '../../core/http/client-meta';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import {
  CreateStockAdjustmentDto,
  RejectStockAdjustmentDto,
  StockAdjustmentsQueryDto,
  StockAdjustmentStepDto,
  UpdateStockAdjustmentDto,
  type ApprovedStockAdjustmentView,
  type StockAdjustmentSummary,
  type StockAdjustmentView,
} from './dto/stock-adjustments.dto';
import { StockAdjustmentsService } from './stock-adjustments.service';

/**
 * Stock adjustments (#8). Anyone signed in reads them, as they read stock and its other
 * documents. `stock_adjustment:raise` (plant, branch manager) drafts and submits;
 * `stock_adjustment:approve` (finance) approves, which posts, or rejects — never an adjustment
 * the approver created, whatever roles they hold (ADR-0008). There is no DELETE: a draft
 * nobody wants is rejected, a posted adjustment is corrected by another one.
 */
@Controller('stock-adjustments')
export class StockAdjustmentsController {
  constructor(private readonly adjustments: StockAdjustmentsService) {}

  @Get()
  list(@Query() query: StockAdjustmentsQueryDto): Promise<StockAdjustmentSummary[]> {
    return this.adjustments.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<StockAdjustmentView> {
    return this.adjustments.get(id);
  }

  @Post()
  @RequirePermissions(Permission.STOCK_ADJUSTMENT_RAISE)
  create(
    @Body() dto: CreateStockAdjustmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<StockAdjustmentView> {
    return this.adjustments.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.STOCK_ADJUSTMENT_RAISE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockAdjustmentDto,
  ): Promise<StockAdjustmentView> {
    return this.adjustments.update(id, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STOCK_ADJUSTMENT_RAISE)
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockAdjustmentStepDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<StockAdjustmentView> {
    return this.adjustments.submit(id, dto, actor);
  }

  /** 200 even when the ledger then refuses the posting: the approval stands (see the view). */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STOCK_ADJUSTMENT_APPROVE)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockAdjustmentStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ApprovedStockAdjustmentView> {
    return this.adjustments.approve(id, dto, actor, clientMeta(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STOCK_ADJUSTMENT_APPROVE)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectStockAdjustmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<StockAdjustmentView> {
    return this.adjustments.reject(id, dto, actor, clientMeta(req));
  }

  /** Posts an approved adjustment again after the ledger refused it. */
  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STOCK_ADJUSTMENT_APPROVE)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockAdjustmentStepDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<StockAdjustmentView> {
    return this.adjustments.post(id, dto, actor);
  }
}

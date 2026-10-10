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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { clientMeta } from '../../core/http/client-meta';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import type { DocumentRef, GenealogyLink } from '../ledger/ledger.service';
import {
  CancelProductionOrderDto,
  CreateProductionOrderDto,
  GenealogyQueryDto,
  ProductionOrderStepDto,
  ProductionOrdersQueryDto,
  RecordActualsDto,
  ReverseProductionOrderDto,
  UpdateProductionOrderDto,
  type ProductionOrderSummary,
  type ProductionOrderView,
} from './dto/production-orders.dto';
import { ProductionOrdersService } from './production-orders.service';

/**
 * Production orders (#13). `production_order:read` (plant, finance) reads them with their yields,
 * costs and genealogy; `production_order:run` (plant, ADR-0008) plans, releases, records, posts,
 * cancels and reverses them. There is no DELETE: a draft or released order is cancelled, a posted
 * one is reversed.
 */
@Controller('production-orders')
export class ProductionOrdersController {
  constructor(private readonly orders: ProductionOrdersService) {}

  @Get()
  @RequirePermissions(Permission.PRODUCTION_ORDER_READ)
  list(@Query() query: ProductionOrdersQueryDto): Promise<ProductionOrderSummary[]> {
    return this.orders.list(query);
  }

  /** Every genealogy link touching a lot, from either side (ADR-0006). */
  @Get('genealogy/:lotId')
  @RequirePermissions(Permission.PRODUCTION_ORDER_READ)
  genealogy(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Query() query: GenealogyQueryDto,
  ): Promise<GenealogyLink[]> {
    return this.orders.lotGenealogy(lotId, query.includeReversed);
  }

  @Get(':id')
  @RequirePermissions(Permission.PRODUCTION_ORDER_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductionOrderView> {
    return this.orders.get(id);
  }

  @Post()
  @RequirePermissions(Permission.PRODUCTION_ORDER_RUN)
  create(
    @Body() dto: CreateProductionOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionOrderView> {
    return this.orders.create(dto, actor, clientMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.PRODUCTION_ORDER_RUN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductionOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionOrderView> {
    return this.orders.update(id, dto, actor, clientMeta(req));
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PRODUCTION_ORDER_RUN)
  release(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProductionOrderStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionOrderView> {
    return this.orders.release(id, dto, actor, clientMeta(req));
  }

  @Put(':id/actuals')
  @RequirePermissions(Permission.PRODUCTION_ORDER_RUN)
  recordActuals(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordActualsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionOrderView> {
    return this.orders.recordActuals(id, dto, actor, clientMeta(req));
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PRODUCTION_ORDER_RUN)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProductionOrderStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionOrderView> {
    return this.orders.post(id, dto, actor, clientMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PRODUCTION_ORDER_RUN)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelProductionOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionOrderView> {
    return this.orders.cancel(id, dto, actor, clientMeta(req));
  }

  @Post(':id/reverse')
  @RequirePermissions(Permission.PRODUCTION_ORDER_RUN)
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseProductionOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ order: ProductionOrderView; reversal: DocumentRef }> {
    return this.orders.reverse(id, dto, actor, clientMeta(req));
  }
}

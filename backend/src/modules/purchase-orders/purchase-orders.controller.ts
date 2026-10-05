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
  CreatePurchaseOrderDto,
  PurchaseOrderReasonDto,
  PurchaseOrdersQueryDto,
  PurchaseOrderStepDto,
  UpdatePurchaseOrderDto,
  type PurchaseOrderSummary,
  type PurchaseOrderView,
} from './dto/purchase-orders.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Purchase orders (#10). `purchase_order:read` (purchasing, purchasing approvers, finance) reads
 * them. `purchase_order:raise` (purchasing) drafts, edits, submits, marks sent and cancels;
 * `purchase_order:approve` (purchasing approvers) approves or rejects one above the approval
 * threshold — never an order the approver created, whatever roles they hold (ADR-0008). There is
 * no DELETE: an order nobody wants is cancelled.
 */
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequirePermissions(Permission.PURCHASE_ORDER_READ)
  list(@Query() query: PurchaseOrdersQueryDto): Promise<PurchaseOrderSummary[]> {
    return this.orders.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.PURCHASE_ORDER_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderView> {
    return this.orders.get(id);
  }

  @Post()
  @RequirePermissions(Permission.PURCHASE_ORDER_RAISE)
  create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PurchaseOrderView> {
    return this.orders.create(dto, actor, clientMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.PURCHASE_ORDER_RAISE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PurchaseOrderView> {
    return this.orders.update(id, dto, actor, clientMeta(req));
  }

  /** At or below the approval threshold the answer is already approved. */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PURCHASE_ORDER_RAISE)
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PurchaseOrderView> {
    return this.orders.submit(id, dto, actor, clientMeta(req));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PURCHASE_ORDER_APPROVE)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PurchaseOrderView> {
    return this.orders.approve(id, dto, actor, clientMeta(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PURCHASE_ORDER_APPROVE)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PurchaseOrderView> {
    return this.orders.reject(id, dto, actor, clientMeta(req));
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PURCHASE_ORDER_RAISE)
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PurchaseOrderView> {
    return this.orders.send(id, dto, actor, clientMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PURCHASE_ORDER_RAISE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PurchaseOrderView> {
    return this.orders.cancel(id, dto, actor, clientMeta(req));
  }
}

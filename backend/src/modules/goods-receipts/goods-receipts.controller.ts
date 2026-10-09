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
  CreateGoodsReceiptDto,
  GoodsReceiptsQueryDto,
  GoodsReceiptStepDto,
  RejectGoodsReceiptDto,
  SupplierReturnsQueryDto,
  UpdateGoodsReceiptDto,
  type GoodsReceiptPreview,
  type GoodsReceiptSummary,
  type GoodsReceiptView,
  type SteppedGoodsReceiptView,
  type SupplierReturnView,
} from './dto/goods-receipts.dto';
import { GoodsReceiptsService } from './goods-receipts.service';

/**
 * Goods receipts (#11). They carry what each received lot cost, so reading needs
 * `goods_receipt:read`. `goods_receipt:receive` (the plant) drafts and submits; a receipt with no
 * findings posts on submission. `goods_receipt:approve` (purchasing approvers) approves one with
 * findings, which posts it, or rejects it — never a receipt the approver created, whatever roles
 * they hold (ADR-0008). There is no DELETE: a draft nobody wants is left, a submitted one is
 * rejected.
 */
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Get()
  @RequirePermissions(Permission.GOODS_RECEIPT_READ)
  list(@Query() query: GoodsReceiptsQueryDto): Promise<GoodsReceiptSummary[]> {
    return this.receipts.list(query);
  }

  /** The lines as they would be saved, with findings and expiry, saving nothing. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.GOODS_RECEIPT_RECEIVE)
  preview(@Body() dto: CreateGoodsReceiptDto): Promise<GoodsReceiptPreview> {
    return this.receipts.preview(dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.GOODS_RECEIPT_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<GoodsReceiptView> {
    return this.receipts.get(id);
  }

  @Post()
  @RequirePermissions(Permission.GOODS_RECEIPT_RECEIVE)
  create(
    @Body() dto: CreateGoodsReceiptDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<GoodsReceiptView> {
    return this.receipts.create(dto, actor, clientMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.GOODS_RECEIPT_RECEIVE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoodsReceiptDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<GoodsReceiptView> {
    return this.receipts.update(id, dto, actor, clientMeta(req));
  }

  /** Posts a receipt with no findings; hands one with findings to an approver. */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.GOODS_RECEIPT_RECEIVE)
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GoodsReceiptStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SteppedGoodsReceiptView> {
    return this.receipts.submit(id, dto, actor, clientMeta(req));
  }

  /** 200 even when the ledger then refuses the posting: the approval stands (see the view). */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.GOODS_RECEIPT_APPROVE)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GoodsReceiptStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SteppedGoodsReceiptView> {
    return this.receipts.approve(id, dto, actor, clientMeta(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.GOODS_RECEIPT_APPROVE)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectGoodsReceiptDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<GoodsReceiptView> {
    return this.receipts.reject(id, dto, actor, clientMeta(req));
  }

  /** Posts an approved receipt again after the ledger refused it. */
  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.GOODS_RECEIPT_APPROVE)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GoodsReceiptStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<GoodsReceiptView> {
    return this.receipts.post(id, dto, actor, clientMeta(req));
  }
}

/** Returns to supplier (#11): created by posting a receipt, read here, never changed. */
@Controller('supplier-returns')
export class SupplierReturnsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Get()
  @RequirePermissions(Permission.GOODS_RECEIPT_READ)
  list(@Query() query: SupplierReturnsQueryDto): Promise<SupplierReturnView[]> {
    return this.receipts.returns(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.GOODS_RECEIPT_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupplierReturnView> {
    return this.receipts.supplierReturn(id);
  }
}

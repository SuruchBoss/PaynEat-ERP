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
  CancelTransferDto,
  CreateTransferDto,
  CreateTransferReceiptDto,
  DispatchTransferDto,
  InTransitQueryDto,
  ReceiptStepDto,
  RejectTransferReceiptDto,
  TransferReceiptsQueryDto,
  TransfersQueryDto,
  UpdateTransferDto,
  UpdateTransferReceiptDto,
  type InTransitView,
  type SteppedTransferReceiptView,
  type TransferReceiptSummary,
  type TransferReceiptView,
  type TransferSummary,
  type TransferView,
} from './dto/transfers.dto';
import { TransferReceiptsService } from './transfer-receipts.service';
import { TransfersService } from './transfers.service';

/**
 * Transfers (#14). `transfer:read` (logistics, plant, branch managers, finance) reads them;
 * `transfer:dispatch` (logistics, ADR-0008) drafts, edits, cancels and dispatches them;
 * `transfer:receive` (branch managers) raises a receipt of a dispatched one. There is no DELETE:
 * a draft is cancelled, and what was dispatched is accounted for by its receipt.
 */
@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly receipts: TransferReceiptsService,
  ) {}

  @Get()
  @RequirePermissions(Permission.TRANSFER_READ)
  list(@Query() query: TransfersQueryDto): Promise<TransferSummary[]> {
    return this.transfers.list(query);
  }

  /**
   * What each transfer holds in transit, lot by lot. Open to any signed-in user, like stock on
   * hand (#7), whose in-transit balances it breaks down: quantities only, no costs.
   */
  @Get('in-transit')
  inTransit(@Query() query: InTransitQueryDto): Promise<InTransitView> {
    return this.transfers.inTransit(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.TRANSFER_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<TransferView> {
    return this.transfers.get(id);
  }

  @Post()
  @RequirePermissions(Permission.TRANSFER_DISPATCH)
  create(
    @Body() dto: CreateTransferDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TransferView> {
    return this.transfers.create(dto, actor, clientMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.TRANSFER_DISPATCH)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransferDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TransferView> {
    return this.transfers.update(id, dto, actor, clientMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TRANSFER_DISPATCH)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTransferDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TransferView> {
    return this.transfers.cancel(id, dto, actor, clientMeta(req));
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TRANSFER_DISPATCH)
  dispatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DispatchTransferDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TransferView> {
    return this.transfers.dispatch(id, dto, actor, clientMeta(req));
  }

  @Post(':id/receipts')
  @RequirePermissions(Permission.TRANSFER_RECEIVE)
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTransferReceiptDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TransferReceiptView> {
    return this.receipts.create(id, dto, actor, clientMeta(req));
  }
}

/**
 * Transfer receipts (#14). `transfer:read` reads them; `transfer:receive` (branch managers) edits
 * and submits them; `transfer:approve_receipt` (the plant, ADR-0008) approves or rejects one with
 * a finding or a write-off, never one it created, and retries the posting of an approved one.
 */
@Controller('transfer-receipts')
export class TransferReceiptsController {
  constructor(private readonly receipts: TransferReceiptsService) {}

  @Get()
  @RequirePermissions(Permission.TRANSFER_READ)
  list(@Query() query: TransferReceiptsQueryDto): Promise<TransferReceiptSummary[]> {
    return this.receipts.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.TRANSFER_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<TransferReceiptView> {
    return this.receipts.get(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TRANSFER_RECEIVE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransferReceiptDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TransferReceiptView> {
    return this.receipts.update(id, dto, actor, clientMeta(req));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TRANSFER_RECEIVE)
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiptStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SteppedTransferReceiptView> {
    return this.receipts.submit(id, dto, actor, clientMeta(req));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TRANSFER_APPROVE_RECEIPT)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiptStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SteppedTransferReceiptView> {
    return this.receipts.approve(id, dto, actor, clientMeta(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TRANSFER_APPROVE_RECEIPT)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTransferReceiptDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TransferReceiptView> {
    return this.receipts.reject(id, dto, actor, clientMeta(req));
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TRANSFER_APPROVE_RECEIPT)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiptStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TransferReceiptView> {
    return this.receipts.post(id, dto, actor, clientMeta(req));
  }
}

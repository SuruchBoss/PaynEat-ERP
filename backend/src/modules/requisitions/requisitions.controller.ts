// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  Body,
  Controller,
  Delete,
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
import {
  CancelRequisitionDto,
  CreateRequisitionDto,
  CreateRequisitionTransferDto,
  ParLevelDto,
  ParLevelsQueryDto,
  ParMissesQueryDto,
  RequisitionsQueryDto,
  RequisitionStepDto,
  SuggestionsQueryDto,
  UpdateRequisitionDto,
  type ParLevelView,
  type ParMissesView,
  type RequisitionSummary,
  type RequisitionView,
  type SuggestionsView,
} from './dto/requisitions.dto';
import { RequisitionsService } from './requisitions.service';

/**
 * Branch requisitions (#15). `requisition:read` (branch managers, logistics, the plant, finance,
 * the admin) reads them, the suggestions and the par-miss report; `requisition:raise` (branch
 * managers) drafts, edits, submits and cancels them; `transfer:dispatch` (logistics) creates a
 * transfer from a submitted one. There is no DELETE: a requisition is cancelled.
 */
@Controller('requisitions')
export class RequisitionsController {
  constructor(private readonly requisitions: RequisitionsService) {}

  @Get()
  @RequirePermissions(Permission.REQUISITION_READ)
  list(@Query() query: RequisitionsQueryDto): Promise<RequisitionSummary[]> {
    return this.requisitions.list(query);
  }

  /** What the requisition screen suggests for a branch now. */
  @Get('suggestions')
  @RequirePermissions(Permission.REQUISITION_READ)
  suggestions(@Query() query: SuggestionsQueryDto): Promise<SuggestionsView> {
    return this.requisitions.suggestions(query.branchId);
  }

  /** Par misses per branch and item over a period (ADR-0009). */
  @Get('par-misses')
  @RequirePermissions(Permission.REQUISITION_READ)
  parMisses(@Query() query: ParMissesQueryDto): Promise<ParMissesView> {
    return this.requisitions.parMisses(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.REQUISITION_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<RequisitionView> {
    return this.requisitions.get(id);
  }

  @Post()
  @RequirePermissions(Permission.REQUISITION_RAISE)
  create(
    @Body() dto: CreateRequisitionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RequisitionView> {
    return this.requisitions.create(dto, actor, clientMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.REQUISITION_RAISE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequisitionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RequisitionView> {
    return this.requisitions.update(id, dto, actor, clientMeta(req));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.REQUISITION_RAISE)
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequisitionStepDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RequisitionView> {
    return this.requisitions.submit(id, dto, actor, clientMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.REQUISITION_RAISE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelRequisitionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RequisitionView> {
    return this.requisitions.cancel(id, dto, actor, clientMeta(req));
  }

  /** A draft transfer from the requisition, prefilled with what is outstanding (#14). */
  @Post(':id/transfers')
  @RequirePermissions(Permission.TRANSFER_DISPATCH)
  createTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRequisitionTransferDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): ReturnType<RequisitionsService['createTransfer']> {
    return this.requisitions.createTransfer(id, dto, actor, clientMeta(req));
  }
}

/**
 * Par levels (#15, ADR-0009 decision 2): how much of each item a branch should hold.
 * `requisition:read` reads them; `par_level:manage` (the admin) sets and removes them.
 */
@Controller('par-levels')
export class ParLevelsController {
  constructor(private readonly requisitions: RequisitionsService) {}

  @Get()
  @RequirePermissions(Permission.REQUISITION_READ)
  list(@Query() query: ParLevelsQueryDto): Promise<ParLevelView[]> {
    return this.requisitions.parLevels(query);
  }

  @Put(':locationId/:itemId')
  @RequirePermissions(Permission.PAR_LEVEL_MANAGE)
  set(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ParLevelDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ParLevelView> {
    return this.requisitions.setParLevel(locationId, itemId, dto, actor, clientMeta(req));
  }

  @Delete(':locationId/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.PAR_LEVEL_MANAGE)
  remove(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.requisitions.removeParLevel(locationId, itemId, actor, clientMeta(req));
  }
}

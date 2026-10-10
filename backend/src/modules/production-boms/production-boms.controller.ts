// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import {
  Body,
  Controller,
  Get,
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
  BomLinesDto,
  CreateBomVersionDto,
  CreateProductionBomDto,
  ProductionBomsQueryDto,
  UpdateProductionBomDto,
  type ProductionBomSummaryView,
  type ProductionBomView,
} from './dto/production-boms.dto';
import { ProductionBomsService } from './production-boms.service';

/**
 * Production BOMs (#12). `production_bom:read` (admin, plant, finance) reads them with their
 * yields and allocation ratios; only `production_bom:manage` (admin, ADR-0008) changes them.
 * There is no DELETE: a BOM is deactivated, and its versions stay readable for the production
 * orders that used them.
 */
@Controller('production-boms')
export class ProductionBomsController {
  constructor(private readonly boms: ProductionBomsService) {}

  @Get()
  @RequirePermissions(Permission.PRODUCTION_BOM_READ)
  list(@Query() query: ProductionBomsQueryDto): Promise<ProductionBomSummaryView[]> {
    return this.boms.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.PRODUCTION_BOM_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductionBomView> {
    return this.boms.get(id);
  }

  @Post()
  @RequirePermissions(Permission.PRODUCTION_BOM_MANAGE)
  create(
    @Body() dto: CreateProductionBomDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionBomView> {
    return this.boms.create(dto, actor, clientMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.PRODUCTION_BOM_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductionBomDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionBomView> {
    return this.boms.update(id, dto, actor, clientMeta(req));
  }

  @Post(':id/versions')
  @RequirePermissions(Permission.PRODUCTION_BOM_MANAGE)
  addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBomVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionBomView> {
    return this.boms.addVersion(id, dto, actor, clientMeta(req));
  }

  @Put('versions/:versionId')
  @RequirePermissions(Permission.PRODUCTION_BOM_MANAGE)
  correctVersion(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: BomLinesDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ProductionBomView> {
    return this.boms.correctVersion(versionId, dto, actor, clientMeta(req));
  }
}

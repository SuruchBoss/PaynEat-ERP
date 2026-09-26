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
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { clientMeta } from '../../core/http/client-meta';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import {
  CreateSupplierDto,
  SuppliersQueryDto,
  UpdateSupplierDto,
  type SupplierView,
} from './dto/suppliers.dto';
import { SuppliersService } from './suppliers.service';

/**
 * Suppliers (#6). Anyone signed in reads them — receiving and finance name them too;
 * `supplier:manage` (admin and purchasing, ADR-0008) changes them. No DELETE.
 */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list(@Query() query: SuppliersQueryDto): Promise<SupplierView[]> {
    return this.suppliers.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupplierView> {
    return this.suppliers.get(id);
  }

  @Post()
  @RequirePermissions(Permission.SUPPLIER_MANAGE)
  create(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SupplierView> {
    return this.suppliers.create(dto, actor, clientMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.SUPPLIER_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SupplierView> {
    return this.suppliers.update(id, dto, actor, clientMeta(req));
  }
}

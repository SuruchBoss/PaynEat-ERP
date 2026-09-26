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
  CreateItemDto,
  ItemsQueryDto,
  UpdateItemDto,
  type ItemView,
  type UnitView,
} from './dto/items.dto';
import { ItemsService } from './items.service';

/**
 * Items and units (#5). Anyone signed in reads them; only `item:manage` (the admin role,
 * ADR-0008) changes them. There is no DELETE: items are deactivated, never deleted.
 */
@Controller()
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  /** The unit catalogue every installation ships with. */
  @Get('units')
  units(): Promise<UnitView[]> {
    return this.items.units();
  }

  @Get('items')
  list(@Query() query: ItemsQueryDto): Promise<ItemView[]> {
    return this.items.list(query);
  }

  @Get('items/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ItemView> {
    return this.items.get(id);
  }

  @Post('items')
  @RequirePermissions(Permission.ITEM_MANAGE)
  create(
    @Body() dto: CreateItemDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ItemView> {
    return this.items.create(dto, actor, clientMeta(req));
  }

  @Patch('items/:id')
  @RequirePermissions(Permission.ITEM_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ItemView> {
    return this.items.update(id, dto, actor, clientMeta(req));
  }
}

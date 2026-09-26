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
  CreateLocationDto,
  LocationsQueryDto,
  SupersedeLocationDto,
  UpdateLocationDto,
  type LocationView,
} from './dto/locations.dto';
import { LocationsService } from './locations.service';

/**
 * Locations (#6). Anyone signed in reads them; only `location:manage` (the admin role,
 * ADR-0008) changes them. There is no DELETE: locations are deactivated, never deleted.
 */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(@Query() query: LocationsQueryDto): Promise<LocationView[]> {
    return this.locations.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<LocationView> {
    return this.locations.get(id);
  }

  @Post()
  @RequirePermissions(Permission.LOCATION_MANAGE)
  create(
    @Body() dto: CreateLocationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<LocationView> {
    return this.locations.create(dto, actor, clientMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.LOCATION_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<LocationView> {
    return this.locations.update(id, dto, actor, clientMeta(req));
  }

  @Post(':id/supersede')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.LOCATION_MANAGE)
  supersede(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupersedeLocationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<LocationView> {
    return this.locations.supersede(id, dto, actor, clientMeta(req));
  }
}

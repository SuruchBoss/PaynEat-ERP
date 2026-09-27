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
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { clientMeta } from '../../core/http/client-meta';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import {
  RegisterPosInstanceDto,
  type IssuedCredentialView,
  type PosInstanceView,
} from './dto/pos-integration.dto';
import { PosInstancesService } from './pos-instances.service';

/**
 * Registering PaynEat POS instances (#9): `pos_instance:manage`, the admin only. A credential
 * appears in exactly two answers — the registration and a new credential — and never again.
 */
@Controller('pos-instances')
@RequirePermissions(Permission.POS_INSTANCE_MANAGE)
export class PosInstancesController {
  constructor(private readonly instances: PosInstancesService) {}

  @Get()
  list(): Promise<PosInstanceView[]> {
    return this.instances.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PosInstanceView> {
    return this.instances.get(id);
  }

  @Post()
  register(
    @Body() dto: RegisterPosInstanceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<IssuedCredentialView> {
    return this.instances.register(dto, actor, clientMeta(req));
  }

  @Post(':id/credentials')
  issueCredential(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<IssuedCredentialView> {
    return this.instances.issueCredential(id, actor, clientMeta(req));
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PosInstanceView> {
    return this.instances.revoke(id, actor, clientMeta(req));
  }
}

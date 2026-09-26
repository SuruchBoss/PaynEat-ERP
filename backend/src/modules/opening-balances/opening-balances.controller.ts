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
} from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../../core/security/current-user';
import { RequirePermissions } from '../../core/security/decorators';
import { Permission } from '../../core/security/permissions';
import {
  CreateOpeningBalanceDto,
  OpeningBalancesQueryDto,
  PostOpeningBalanceDto,
  ReverseOpeningBalanceDto,
  UpdateOpeningBalanceDto,
  type OpeningBalanceSummary,
  type OpeningBalanceView,
} from './dto/opening-balances.dto';
import { OpeningBalancesService } from './opening-balances.service';

/**
 * Opening balances (#7). Anyone signed in reads them, as the issue asks of stock and its
 * documents; `opening_balance:manage` (the plant role, ADR-0008) drafts, posts and reverses.
 * There is no DELETE: a posted document is reversed, never removed.
 */
@Controller('opening-balances')
export class OpeningBalancesController {
  constructor(private readonly openingBalances: OpeningBalancesService) {}

  @Get()
  list(@Query() query: OpeningBalancesQueryDto): Promise<OpeningBalanceSummary[]> {
    return this.openingBalances.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OpeningBalanceView> {
    return this.openingBalances.get(id);
  }

  @Post()
  @RequirePermissions(Permission.OPENING_BALANCE_MANAGE)
  create(
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OpeningBalanceView> {
    return this.openingBalances.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.OPENING_BALANCE_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpeningBalanceDto,
  ): Promise<OpeningBalanceView> {
    return this.openingBalances.update(id, dto);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.OPENING_BALANCE_MANAGE)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostOpeningBalanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OpeningBalanceView> {
    return this.openingBalances.post(id, dto, actor);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.OPENING_BALANCE_MANAGE)
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseOpeningBalanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OpeningBalanceView> {
    return this.openingBalances.reverse(id, dto, actor);
  }
}

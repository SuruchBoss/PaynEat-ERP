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
  CreateMenuItemDto,
  CreateModifierGroupDto,
  CreateRecipeVersionDto,
  MenuItemsQueryDto,
  RecipeLinesDto,
  SetMenuPriceDto,
  UpdateMenuItemDto,
  UpdateModifierGroupDto,
  type MenuItemDetailView,
  type MenuItemView,
  type ModifierGroupView,
  type RecipeView,
} from './dto/menu.dto';
import { MenuItemsService } from './menu-items.service';
import { ModifierGroupsService } from './modifier-groups.service';
import { RecipesService } from './recipes.service';

/**
 * Menu items, prices, modifier groups and versioned recipes (#16). `menu:read` (admin, finance,
 * branch managers) reads them, recipes and theoretical costs included; only `menu:manage`
 * (admin, ADR-0008) changes them. There is no DELETE: menu master data is deactivated, never
 * deleted. A connected POS reads the same data through the master data change log (contract 1.1).
 */
@Controller()
export class MenuController {
  constructor(
    private readonly menuItems: MenuItemsService,
    private readonly modifierGroups: ModifierGroupsService,
    private readonly recipes: RecipesService,
  ) {}

  @Get('menu-items')
  @RequirePermissions(Permission.MENU_READ)
  list(@Query() query: MenuItemsQueryDto): Promise<MenuItemView[]> {
    return this.menuItems.list(query);
  }

  @Get('menu-items/:id')
  @RequirePermissions(Permission.MENU_READ)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<MenuItemDetailView> {
    return this.menuItems.get(id);
  }

  @Post('menu-items')
  @RequirePermissions(Permission.MENU_MANAGE)
  create(
    @Body() dto: CreateMenuItemDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MenuItemDetailView> {
    return this.menuItems.create(dto, actor, clientMeta(req));
  }

  @Patch('menu-items/:id')
  @RequirePermissions(Permission.MENU_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MenuItemDetailView> {
    return this.menuItems.update(id, dto, actor, clientMeta(req));
  }

  /** Sets a price from a date, chain-wide or for one branch; again for the same day corrects it. */
  @Post('menu-items/:id/prices')
  @RequirePermissions(Permission.MENU_MANAGE)
  setPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMenuPriceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MenuItemDetailView> {
    return this.menuItems.setPrice(id, dto, actor, clientMeta(req));
  }

  @Get('menu-items/:id/recipe')
  @RequirePermissions(Permission.MENU_READ)
  menuRecipe(@Param('id', ParseUUIDPipe) id: string): Promise<RecipeView> {
    return this.recipes.recipe('menu', id);
  }

  @Post('menu-items/:id/recipe-versions')
  @RequirePermissions(Permission.MENU_MANAGE)
  addMenuRecipeVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRecipeVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RecipeView> {
    return this.recipes.addVersion('menu', id, dto, actor, clientMeta(req));
  }

  @Get('modifier-groups')
  @RequirePermissions(Permission.MENU_READ)
  listGroups(): Promise<ModifierGroupView[]> {
    return this.modifierGroups.list();
  }

  @Get('modifier-groups/:id')
  @RequirePermissions(Permission.MENU_READ)
  getGroup(@Param('id', ParseUUIDPipe) id: string): Promise<ModifierGroupView> {
    return this.modifierGroups.get(id);
  }

  @Post('modifier-groups')
  @RequirePermissions(Permission.MENU_MANAGE)
  createGroup(
    @Body() dto: CreateModifierGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ModifierGroupView> {
    return this.modifierGroups.create(dto, actor, clientMeta(req));
  }

  @Patch('modifier-groups/:id')
  @RequirePermissions(Permission.MENU_MANAGE)
  updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateModifierGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ModifierGroupView> {
    return this.modifierGroups.update(id, dto, actor, clientMeta(req));
  }

  @Get('modifier-options/:id/recipe')
  @RequirePermissions(Permission.MENU_READ)
  modifierRecipe(@Param('id', ParseUUIDPipe) id: string): Promise<RecipeView> {
    return this.recipes.recipe('modifier', id);
  }

  @Post('modifier-options/:id/recipe-versions')
  @RequirePermissions(Permission.MENU_MANAGE)
  addModifierRecipeVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRecipeVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RecipeView> {
    return this.recipes.addVersion('modifier', id, dto, actor, clientMeta(req));
  }

  /** Corrects the lines of a version that has not taken effect; one in force never changes. */
  @Put('recipe-versions/:id/lines')
  @RequirePermissions(Permission.MENU_MANAGE)
  replaceLines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecipeLinesDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RecipeView> {
    return this.recipes.replaceLines(id, dto, actor, clientMeta(req));
  }
}

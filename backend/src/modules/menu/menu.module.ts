// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LocationsModule } from '../locations/locations.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { MenuController } from './menu.controller';
import { MenuItemsService } from './menu-items.service';
import { ModifierGroupsService } from './modifier-groups.service';
import { RecipesService } from './recipes.service';

/**
 * The menu (#16): menu items, prices, modifier groups and versioned recipes, master data a
 * POS mirrors through the change log (contract 1.1). Owns `menu_items`, `menu_prices`,
 * `modifier_groups`, `modifier_options`, `recipe_versions` and `recipe_lines`. Reads current
 * lot costs from the ledger for the theoretical cost of a recipe; writes no stock.
 */
@Module({
  imports: [MasterDataModule, ItemsModule, LocationsModule, LedgerModule],
  controllers: [MenuController],
  providers: [MenuItemsService, ModifierGroupsService, RecipesService],
  exports: [MenuItemsService, ModifierGroupsService, RecipesService],
})
export class MenuModule {}

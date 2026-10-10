// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Injectable } from '@nestjs/common';
import type { MenuSoldBy, Prisma } from '@prisma/client';
import type { SaleLine, SaleUsage } from './domain/sale-usage';
import { MenuItemsService } from './menu-items.service';
import { RecipesService } from './recipes.service';

export type { SaleLine, SaleUsage } from './domain/sale-usage';

/**
 * What other modules may ask the menu (ADR-0010): what a sale used (#17), and a menu item's
 * code and names.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly recipes: RecipesService,
    private readonly menuItems: MenuItemsService,
  ) {}

  /** What one sale line uses on its sale date, or why it cannot be worked out (#17). */
  saleUsage(
    line: SaleLine,
    tx?: Prisma.TransactionClient,
  ): Promise<{ menuItemId: string | null; usage: SaleUsage }> {
    return this.recipes.saleUsage(line, tx);
  }

  describeMenuItem(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; code: string; nameTh: string; nameEn: string; soldBy: MenuSoldBy }> {
    return this.menuItems.describe(id, tx);
  }
}

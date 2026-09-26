// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Controller, Get, Query } from '@nestjs/common';
import { StockOnHandQueryDto, type StockOnHandView } from './dto/ledger.dto';
import { LedgerService } from './ledger.service';

/**
 * Stock on hand (#7). The issue opens it to anyone signed in: every role needs to see what
 * is where, and its value, so it declares no permission.
 */
@Controller()
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('stock-on-hand')
  stockOnHand(@Query() query: StockOnHandQueryDto): Promise<StockOnHandView> {
    return this.ledger.stockOnHand(query);
  }
}

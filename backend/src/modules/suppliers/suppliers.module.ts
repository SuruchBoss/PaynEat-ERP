// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/** The companies the chain buys from (#6). Owns `suppliers`. */
@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}

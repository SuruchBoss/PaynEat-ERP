// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The ledger, opening-balance, stock-adjustment, purchase-order, goods-receipt, production-order and
 * transfer services, wired
 * by hand for scripts that run without the API:
 * the demo seed and `npm run ledger:rebuild-balances`. The same code the API runs, so no script
 * writes stock any other way than the ledger module does (#7, ADR-0010).
 */
import type { PrismaClient } from '@prisma/client';
import type { RootConfig } from '../src/core/config/configuration';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { SequenceService } from '../src/core/sequence/sequence.service';
import { MetricsService } from '../src/core/telemetry/metrics.service';
import { stdoutSink, TelemetryLogger } from '../src/core/telemetry/telemetry-logger';
import { isTimeZone } from '../src/core/time/domain/business-date';
import { AuditService } from '../src/modules/audit/audit.service';
import { CompanyService } from '../src/modules/company/company.service';
import { GoodsReceiptsService } from '../src/modules/goods-receipts/goods-receipts.service';
import { ItemsService } from '../src/modules/items/items.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { LocationsService } from '../src/modules/locations/locations.service';
import { MasterDataService } from '../src/modules/master-data/master-data.service';
import { OpeningBalancesService } from '../src/modules/opening-balances/opening-balances.service';
import { ProductionBomsService } from '../src/modules/production-boms/production-boms.service';
import { ProductionOrdersService } from '../src/modules/production-orders/production-orders.service';
import { PurchaseOrdersService } from '../src/modules/purchase-orders/purchase-orders.service';
import { StockAdjustmentsService } from '../src/modules/stock-adjustments/stock-adjustments.service';
import { SuppliersService } from '../src/modules/suppliers/suppliers.service';
import { TransferReceiptsService } from '../src/modules/transfers/transfer-receipts.service';
import { TransfersService } from '../src/modules/transfers/transfers.service';

export interface LedgerServices {
  ledger: LedgerService;
  openingBalances: OpeningBalancesService;
  stockAdjustments: StockAdjustmentsService;
  company: CompanyService;
  purchaseOrders: PurchaseOrdersService;
  goodsReceipts: GoodsReceiptsService;
  productionOrders: ProductionOrdersService;
  transfers: TransfersService;
  transferReceipts: TransferReceiptsService;
  items: ItemsService;
}

/**
 * `quiet` drops the JSON log lines (the seed prints its own summary); otherwise they go to
 * stdout as the API writes them. The time zone comes from COMPANY_TIME_ZONE, as in the API.
 */
export function ledgerServices(
  prisma: PrismaClient,
  options: { quiet?: boolean } = {},
): LedgerServices {
  const timeZone = process.env.COMPANY_TIME_ZONE ?? 'Asia/Bangkok';
  if (!isTimeZone(timeZone)) {
    throw new Error(`COMPANY_TIME_ZONE "${timeZone}" is not a time zone this runtime knows`);
  }
  // Only what these services read: the company's time zone and how to write log lines.
  const config = {
    app: { timeZone },
    telemetry: { level: 'INFO', format: 'default', metricsPort: 0 },
  } as unknown as RootConfig;
  const logger = new TelemetryLogger(config, options.quiet ? () => undefined : stdoutSink);
  const metrics = new MetricsService(config, logger);
  const db = prisma as PrismaService;
  const audit = new AuditService(db, logger);
  const masterData = new MasterDataService(db);
  const items = new ItemsService(db, masterData, audit);
  const locations = new LocationsService(db, masterData, audit);
  const ledger = new LedgerService(
    db,
    new SequenceService(),
    items,
    locations,
    logger,
    metrics,
    config,
  );
  const company = new CompanyService(db, audit);
  const suppliers = new SuppliersService(db, audit);
  const purchaseOrders = new PurchaseOrdersService(
    db,
    new SequenceService(),
    items,
    locations,
    suppliers,
    company,
    audit,
    logger,
    config,
  );
  const transfers = new TransfersService(db, ledger, items, locations, audit, logger, metrics);
  return {
    ledger,
    openingBalances: new OpeningBalancesService(db, ledger, items, locations),
    stockAdjustments: new StockAdjustmentsService(db, ledger, items, locations, audit, logger),
    company,
    purchaseOrders,
    goodsReceipts: new GoodsReceiptsService(
      db,
      ledger,
      new SequenceService(),
      purchaseOrders,
      items,
      locations,
      suppliers,
      audit,
      logger,
    ),
    productionOrders: new ProductionOrdersService(
      db,
      ledger,
      new ProductionBomsService(db, audit, items, ledger),
      items,
      locations,
      audit,
      logger,
      metrics,
    ),
    transfers,
    transferReceipts: new TransferReceiptsService(db, ledger, transfers, items, audit, logger),
    items,
  };
}

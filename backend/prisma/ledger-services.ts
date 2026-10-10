// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The ledger, opening-balance, stock-adjustment, purchase-order, goods-receipt, production-order,
 * transfer, sales-event and branch-consumption services, wired
 * by hand for scripts that run without the API:
 * the demo seed and `npm run ledger:rebuild-balances`. The same code the API runs, so no script
 * writes stock any other way than the ledger module does (#7, ADR-0010).
 */
import type { PrismaClient } from '@prisma/client';
import type { RootConfig } from '../src/core/config/configuration';
import { JobLockService } from '../src/core/jobs/job-lock.service';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { SequenceService } from '../src/core/sequence/sequence.service';
import { MetricsService } from '../src/core/telemetry/metrics.service';
import { stdoutSink, TelemetryLogger } from '../src/core/telemetry/telemetry-logger';
import { isTimeZone } from '../src/core/time/domain/business-date';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { BranchConsumptionService } from '../src/modules/branch-consumption/branch-consumption.service';
import { CompanyService } from '../src/modules/company/company.service';
import { GoodsReceiptsService } from '../src/modules/goods-receipts/goods-receipts.service';
import { ItemsService } from '../src/modules/items/items.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { LocationsService } from '../src/modules/locations/locations.service';
import { MasterDataService } from '../src/modules/master-data/master-data.service';
import { MenuItemsService } from '../src/modules/menu/menu-items.service';
import { MenuService } from '../src/modules/menu/menu.service';
import { ModifierGroupsService } from '../src/modules/menu/modifier-groups.service';
import { RecipesService } from '../src/modules/menu/recipes.service';
import { OpeningBalancesService } from '../src/modules/opening-balances/opening-balances.service';
import { PosInstancesService } from '../src/modules/pos-integration/pos-instances.service';
import { PosIntegrationService } from '../src/modules/pos-integration/pos-integration.service';
import { SalesEventsService } from '../src/modules/pos-integration/sales-events.service';
import { ProductionBomsService } from '../src/modules/production-boms/production-boms.service';
import { ProductionOrdersService } from '../src/modules/production-orders/production-orders.service';
import { PurchaseOrdersService } from '../src/modules/purchase-orders/purchase-orders.service';
import { RequisitionsService } from '../src/modules/requisitions/requisitions.service';
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
  requisitions: RequisitionsService;
  items: ItemsService;
  posInstances: PosInstancesService;
  salesEvents: SalesEventsService;
  branchConsumption: BranchConsumptionService;
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
    app: { timeZone, salesConsumptionIntervalSeconds: 0 },
    jobs: { lockTimeoutMs: 300_000 },
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
  const posInstances = new PosInstancesService(db, locations, masterData, audit, logger, metrics);
  const salesEvents = new SalesEventsService(db, posInstances, logger, metrics);
  const menuItems = new MenuItemsService(db, masterData, audit, ledger, locations);
  const recipes = new RecipesService(
    db,
    masterData,
    audit,
    items,
    ledger,
    menuItems,
    new ModifierGroupsService(db, masterData, audit),
  );
  // Branch consumption needs only the automatic account from the auth module: the rest of sign-in
  // has no place in a script. It is the same method the API runs.
  const auth = {
    systemActor: (tx?: PrismaService) => AuthService.prototype.systemActor.call({ prisma: db }, tx),
  } as unknown as AuthService;
  const branchConsumption = new BranchConsumptionService(
    config,
    db,
    ledger,
    new PosIntegrationService(salesEvents),
    new MenuService(recipes, menuItems),
    items,
    locations,
    company,
    auth,
    logger,
    metrics,
    new JobLockService(db, config, logger),
  );
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
    requisitions: new RequisitionsService(
      db,
      new SequenceService(),
      ledger,
      items,
      locations,
      transfers,
      audit,
      logger,
    ),
    items,
    posInstances,
    salesEvents,
    branchConsumption,
  };
}

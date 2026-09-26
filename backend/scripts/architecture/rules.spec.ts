// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { checkArchitecture, importSpecifiers, SourceFile } from './rules';

const file = (path: string, ...imports: string[]): SourceFile => ({
  path,
  content: imports.join('\n'),
});

describe('architecture rules (ADR-0010)', () => {
  it('finds every form of import', () => {
    expect(
      importSpecifiers(
        [
          "import { A } from './a';",
          "import type { B } from '../b';",
          "import './side-effect';",
          "export { C } from './c';",
          "const d = await import('./d');",
          "const e = require('./e');",
          'import {\n  F,\n  G,\n} from "./fg";',
        ].join('\n'),
      ).sort(),
    ).toEqual(['../b', './a', './c', './d', './e', './fg', './side-effect'].sort());
  });

  describe('domain-purity', () => {
    it('fails when a domain/ file imports NestJS', () => {
      const v = checkArchitecture([
        file('src/modules/lots/domain/fefo.ts', "import { Injectable } from '@nestjs/common';"),
      ]);
      expect(v).toEqual([
        expect.objectContaining({ rule: 'domain-purity', specifier: '@nestjs/common' }),
      ]);
    });

    it('fails when a domain/ file imports Prisma', () => {
      const v = checkArchitecture([
        file('src/modules/lots/domain/fefo.ts', "import { Prisma } from '@prisma/client';"),
        file('src/core/telemetry/domain/x.ts', "const p = require('prisma/config');"),
      ]);
      expect(v.map((x) => x.rule)).toEqual(['domain-purity', 'domain-purity']);
    });

    it('fails when a domain/ file imports something outside a domain/ folder', () => {
      const v = checkArchitecture([
        file('src/modules/lots/domain/fefo.ts', "import { LotsService } from '../lots.service';"),
      ]);
      expect(v).toEqual([
        expect.objectContaining({ rule: 'domain-purity', specifier: '../lots.service' }),
      ]);
    });

    it('passes pure domain code that imports other domain code', () => {
      expect(
        checkArchitecture([
          file('src/modules/lots/domain/fefo.ts', "import { daysBetween } from './dates';"),
          file(
            'src/modules/lots/domain/cost.ts',
            "import { x } from '../../../core/telemetry/domain/log-record';",
          ),
        ]),
      ).toEqual([]);
    });
  });

  describe('module-boundary', () => {
    it("fails when a module imports another module's internals", () => {
      const v = checkArchitecture([
        file(
          'src/modules/purchasing/purchasing.service.ts',
          "import { LotRepo } from '../lots/lots.repository';",
        ),
        file(
          'src/modules/purchasing/purchasing.service.ts',
          "import { pickFefo } from '../lots/domain/fefo';",
        ),
      ]);
      expect(v.map((x) => [x.rule, x.specifier])).toEqual([
        ['module-boundary', '../lots/lots.repository'],
        ['module-boundary', '../lots/domain/fefo'],
      ]);
    });

    it('passes a module that calls another through its service or imports its module', () => {
      expect(
        checkArchitecture([
          file(
            'src/modules/purchasing/purchasing.service.ts',
            "import { LotsService } from '../lots/lots.service';",
          ),
          file(
            'src/modules/purchasing/purchasing.module.ts',
            "import { LotsModule } from '../lots/lots.module';",
          ),
          file(
            'src/modules/purchasing/dto/po.dto.ts',
            "import { x } from '../purchasing.service';",
          ),
          file('src/app.module.ts', "import { LotsModule } from './modules/lots/lots.module';"),
        ]),
      ).toEqual([]);
    });
  });

  describe('core-never-imports-ee', () => {
    it('fails when core code imports from ee/, by path or by package', () => {
      const v = checkArchitecture([
        file('src/modules/lots/lots.service.ts', "import { x } from '../../../../ee/backend/x';"),
        file('src/main.ts', "import { y } from '@payneat/ee';"),
        file('src/app.module.ts', "const z = require('../../ee');"),
      ]);
      expect(v.map((x) => [x.rule, x.specifier])).toEqual([
        ['core-never-imports-ee', '../../../../ee/backend/x'],
        ['core-never-imports-ee', '@payneat/ee'],
        ['core-never-imports-ee', '../../ee'],
      ]);
    });

    it('passes names that merely contain the letters ee', () => {
      expect(
        checkArchitecture([
          file('src/modules/fees/fees.service.ts', "import { x } from './fee.domain';"),
          file('src/main.ts', "import { y } from 'free-ports';"),
        ]),
      ).toEqual([]);
    });
  });

  describe('ledger-writes (#7)', () => {
    it('fails when another module writes a ledger table through Prisma', () => {
      const v = checkArchitecture([
        file(
          'src/modules/purchasing/receipts.service.ts',
          'await tx.ledgerEntry.create({ data });',
          'await this.prisma.stockBalance.update({ where, data });',
          'await tx.lot.createMany({ data: lots });',
          'await tx.stockDocument.update({ where, data });',
        ),
      ]);
      expect(v.map((x) => [x.rule, x.specifier])).toEqual([
        ['ledger-writes', '.ledgerEntry.create('],
        ['ledger-writes', '.stockBalance.update('],
        ['ledger-writes', '.lot.createMany('],
        ['ledger-writes', '.stockDocument.update('],
      ]);
    });

    it('fails when anything outside the ledger module writes a ledger table in SQL', () => {
      const v = checkArchitecture([
        file(
          'src/modules/counts/counts.service.ts',
          'await tx.$executeRaw`INSERT INTO "ledger_entries" ("id") VALUES (${id})`;',
          "await tx.$executeRawUnsafe('update stock_balances set quantity = 0');",
          'await tx.$executeRaw`DELETE FROM public.lots`;',
        ),
        file('src/core/jobs/cleanup.ts', 'await db.$executeRaw`TRUNCATE TABLE "stock_documents"`;'),
      ]);
      expect(v.map((x) => [x.rule, x.file])).toEqual([
        ['ledger-writes', 'src/modules/counts/counts.service.ts'],
        ['ledger-writes', 'src/modules/counts/counts.service.ts'],
        ['ledger-writes', 'src/modules/counts/counts.service.ts'],
        ['ledger-writes', 'src/core/jobs/cleanup.ts'],
      ]);
    });

    it('passes reads elsewhere, lookalike names, and the ledger module itself', () => {
      expect(
        checkArchitecture([
          file(
            'src/modules/reports/reports.service.ts',
            'await tx.ledgerEntry.findMany({ where });',
            'await tx.$queryRaw`SELECT * FROM "stock_balances" FOR UPDATE`;',
            'await tx.$executeRaw`UPDATE "lots_archive" SET x = 1`;',
            'await tx.lotSize.update({ where, data });',
          ),
          file(
            'src/modules/ledger/ledger.service.ts',
            'await tx.$executeRaw`INSERT INTO "ledger_entries" ("id") VALUES (${id})`;',
            'await tx.$executeRaw`LOCK TABLE "stock_balances" IN EXCLUSIVE MODE`;',
            'await tx.stockDocument.create({ data });',
          ),
        ]),
      ).toEqual([]);
    });
  });

  describe('ledger-raw-sql (#7)', () => {
    it('fails when the ledger module writes lots, entries or balances through Prisma', () => {
      const v = checkArchitecture([
        file(
          'src/modules/ledger/ledger.service.ts',
          'await tx.ledgerEntry.createMany({ data });',
          'await tx.stockBalance.upsert({ where, create, update });',
        ),
      ]);
      expect(v.map((x) => [x.rule, x.specifier])).toEqual([
        ['ledger-raw-sql', '.ledgerEntry.createMany('],
        ['ledger-raw-sql', '.stockBalance.upsert('],
      ]);
    });
  });
});

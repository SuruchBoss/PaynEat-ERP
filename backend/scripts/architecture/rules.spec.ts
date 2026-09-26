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
});

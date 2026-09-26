// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

/**
 * The architecture rules of ADR-0010, as pure functions over source text, so each
 * rule can be shown to fail on a deliberate violation in `rules.spec.ts`.
 *
 *  1. domain-purity — a file in any `domain/` folder imports no framework, no Prisma,
 *     and nothing outside a `domain/` folder (which could pull either in behind it).
 *     Business rules there must run with no database, framework or clock.
 *  2. module-boundary — a file in `src/modules/<a>/` may reach into another module
 *     `<b>` only through `<b>.service` (or `<b>.module`, to import the module itself),
 *     never through its repositories, domain, DTOs or anything else.
 *
 *  3. core-never-imports-ee — nothing in `backend/` imports from the repository's `ee/`
 *     directory, by relative path or by a package name containing `ee` as a segment
 *     (ADR-0015: the Community core must build and run with `ee/` deleted).
 *
 *  4. ledger-writes — nothing outside `src/modules/ledger/` writes the ledger's tables
 *     (lots, ledger entries, balances, and the document headers the ledger numbers and
 *     posts), through Prisma or in SQL (#7, ADR-0010 decision 4).
 *  5. ledger-raw-sql — inside the ledger module, lots, ledger entries and balances are
 *     written only in raw SQL, never through Prisma's model methods: the locks and the
 *     single transaction must be visible in the code that does them (ADR-0010).
 */
import { posix } from 'node:path';

export interface SourceFile {
  /** Posix path relative to `backend/`, e.g. `src/modules/lots/domain/fefo.ts`. */
  path: string;
  content: string;
}

export type RuleName =
  | 'domain-purity'
  | 'module-boundary'
  | 'core-never-imports-ee'
  | 'ledger-writes'
  | 'ledger-raw-sql';

export interface Violation {
  rule: RuleName;
  file: string;
  specifier: string;
  message: string;
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?[^'"`;]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Every module specifier a file imports, re-exports, requires or loads dynamically. */
export function importSpecifiers(content: string): string[] {
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of content.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

const FRAMEWORK = [/^@nestjs\//, /^@prisma\//, /^prisma(\/|$)/, /^\.prisma(\/|$)/];

/** `ee/` at the repository root, seen from `backend/`, or a package such as `@payneat/ee`. */
const reachesEnterprise = (target: string | undefined, specifier: string): boolean =>
  (target !== undefined && /^\.\.\/ee(\/|$)/.test(target)) || /(^|\/)ee(\/|$)/.test(specifier);

const inDomainFolder = (path: string): boolean => path.split('/').includes('domain');

/** Written in raw SQL only, and only by the ledger module. */
const STOCK_TABLES = ['lots', 'ledger_entries', 'stock_balances'];
const STOCK_MODELS = ['lot', 'ledgerEntry', 'stockBalance'];
/** Owned by the ledger module, which may write it through Prisma. */
const HEADER_TABLES = ['stock_documents'];
const HEADER_MODELS = ['stockDocument'];

const PRISMA_WRITES =
  'create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany';
const prismaWrite = (models: string[]) =>
  new RegExp(`\\.(${models.join('|')})\\s*\\.\\s*(${PRISMA_WRITES})\\s*\\(`, 'g');
const sqlWrite = (tables: string[]) =>
  new RegExp(
    `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?|MERGE\\s+INTO|COPY|LOCK\\s+TABLE)\\s+(?:ONLY\\s+)?(?:"?public"?\\.)?"?(${tables.join('|')})\\b"?`,
    'gi',
  );

const LEDGER_WRITES_OUTSIDE = [
  prismaWrite([...STOCK_MODELS, ...HEADER_MODELS]),
  sqlWrite([...STOCK_TABLES, ...HEADER_TABLES]),
];
const PRISMA_STOCK_WRITE = prismaWrite(STOCK_MODELS);

/** Every write to a ledger table the pattern finds, as the text that matched. */
function writesIn(content: string, patterns: RegExp[]): string[] {
  return patterns.flatMap((pattern) => [...content.matchAll(pattern)].map((m) => m[0].trim()));
}

/** `src/modules/<name>/...` → `<name>`; anything else → undefined. */
function moduleOf(path: string): string | undefined {
  const parts = path.split('/');
  return parts[0] === 'src' && parts[1] === 'modules' && parts.length > 3 ? parts[2] : undefined;
}

function resolveRelative(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  return posix.normalize(posix.join(posix.dirname(from), specifier)).replace(/\.(ts|js)$/, '');
}

export function checkArchitecture(files: SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const specifiers = importSpecifiers(file.content);

    if (inDomainFolder(file.path)) {
      for (const specifier of specifiers) {
        const target = resolveRelative(file.path, specifier);
        if (FRAMEWORK.some((re) => re.test(specifier))) {
          violations.push({
            rule: 'domain-purity',
            file: file.path,
            specifier,
            message: `a domain/ file imports "${specifier}": business rules must not depend on NestJS or Prisma`,
          });
        } else if (target !== undefined && !inDomainFolder(target)) {
          violations.push({
            rule: 'domain-purity',
            file: file.path,
            specifier,
            message: `a domain/ file imports "${specifier}", which is outside any domain/ folder and may pull a framework in behind it`,
          });
        }
      }
    }

    for (const specifier of specifiers) {
      if (reachesEnterprise(resolveRelative(file.path, specifier), specifier)) {
        violations.push({
          rule: 'core-never-imports-ee',
          file: file.path,
          specifier,
          message: `the Community core imports "${specifier}" from ee/; it must build and run without it (ADR-0015)`,
        });
      }
    }

    const owner = moduleOf(file.path);
    if (file.path.startsWith('src/') && owner !== 'ledger') {
      for (const write of writesIn(file.content, LEDGER_WRITES_OUTSIDE)) {
        violations.push({
          rule: 'ledger-writes',
          file: file.path,
          specifier: write,
          message: `"${write}" writes a ledger table outside the ledger module; post through LedgerService (ADR-0010)`,
        });
      }
    }
    if (owner === 'ledger') {
      for (const write of writesIn(file.content, [PRISMA_STOCK_WRITE])) {
        violations.push({
          rule: 'ledger-raw-sql',
          file: file.path,
          specifier: write,
          message: `"${write}" writes lots, entries or balances through Prisma; the ledger writes them only in raw SQL inside the posting transaction (ADR-0010)`,
        });
      }
    }

    if (owner) {
      for (const specifier of specifiers) {
        const target = resolveRelative(file.path, specifier);
        const other = target ? moduleOf(`${target}.ts`) : undefined;
        if (!target || !other || other === owner) continue;

        const allowed = [
          `src/modules/${other}/${other}.service`,
          `src/modules/${other}/${other}.module`,
        ];
        if (!allowed.includes(target)) {
          violations.push({
            rule: 'module-boundary',
            file: file.path,
            specifier,
            message: `module "${owner}" reaches into "${target}"; use ${other}.service (ADR-0010: a module owns its tables, others call its service)`,
          });
        }
      }
    }
  }

  return violations;
}

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
 * From #7 a third rule joins them: nothing outside the ledger module writes ledger or
 * balance tables.
 */
import { posix } from 'node:path';

export interface SourceFile {
  /** Posix path relative to `backend/`, e.g. `src/modules/lots/domain/fefo.ts`. */
  path: string;
  content: string;
}

export type RuleName = 'domain-purity' | 'module-boundary';

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

const inDomainFolder = (path: string): boolean => path.split('/').includes('domain');

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

    const owner = moduleOf(file.path);
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

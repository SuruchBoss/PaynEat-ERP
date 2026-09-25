# ADR-0010: Stack — NestJS, Prisma and raw-SQL ledger posting, React console; aligned with Cwork

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0010-backend-and-web-stack.th.md](0010-backend-and-web-stack.th.md)

## Context

The design session first chose Express with the Kysely query builder, mainly because agents
already knew PaynEat POS's Express layering, and because the ledger needs explicit SQL, transactions
and row locks (ADR-0003) that an ORM can hide.

Before any code was written, a closer look at [Cwork](https://github.com/SuruchBoss/Cwork), the
companion HRIS by the same maintainer, showed that it already has the shape this ERP needs, more
than the POS does:

- A NestJS 11 modular monolith over PostgreSQL 16, where each module owns its tables and modules
  call each other's services, never each other's repositories.
- Business rules as pure functions in each module's `domain/` folder, tested without a database.
- A transactional outbox (`FOR UPDATE SKIP LOCKED`), job locks for scheduled work, and a sequence
  service for gap-free document numbers — all written in raw SQL through Prisma where it matters.
- JWT authentication with multi-factor sign-in, a permissions guard, and an audit log.
- End-to-end tests with Jest and supertest against a real PostgreSQL that is migrated, wiped and
  seeded with a demo company before the run.
- A React 19 + Vite console with its own Thai/English i18n and accessibility checks in its tests.

## Decision

1. **Repository layout:** `backend/` (NestJS API), `web/` (React console), `contracts/` (the
   versioned OpenAPI document and event JSON schemas shared with PaynEat POS, ADR-0002), and a
   `docker-compose.yml` that runs PostgreSQL, the API and the console.
2. **Backend:** NestJS 11 modular monolith, TypeScript, PostgreSQL 16. Module boundaries follow
   Cwork's ADR-0001: a module owns its tables; other modules use its service.
3. **Pure domain functions:** every rule that is expensive to get wrong — FEFO picking, cost
   allocation, yield, tolerance checks, segregation of duties, par suggestions — lives in
   `modules/<name>/domain/` as a pure function with no database, framework or clock unless injected.
4. **Data access:** Prisma for schema, migrations and ordinary reads and writes. **The ledger is the
   exception:** posting a document and locking lot balances is done only by the ledger module, only
   in raw SQL inside one database transaction, with balance rows locked in a consistent order. No
   other module writes ledger or balance tables, through Prisma or otherwise.
5. **Web console:** React 19, Vite, TanStack Query, React Router, zod. Thai and English from the
   first screen, following Cwork's i18n approach. Vitest with Testing Library and axe for
   accessibility.
6. **Tests:** Jest unit tests for domain functions; Jest + supertest end-to-end tests that call the
   real HTTP API against a real PostgreSQL migrated, wiped and seeded with the fried-chicken demo
   chain before the run. The end-to-end suite is what the definition of done in `CLAUDE.md` means.
7. **Reuse from Cwork by copying, with provenance, not by a shared package.** Configuration and
   environment validation, error handling, the Prisma service, the outbox, the permissions guard and
   decorators, the sequence service, authentication with multi-factor sign-in, the audit module,
   job locks, and the console shell (layout, i18n, API client, route guards) are copied and adapted.
   Roles are replaced with the seven ERP roles (ADR-0008). `NOTICE` records the provenance.
8. **Architecture check in CI:** a script, in the spirit of PaynEat POS's layer check, fails the build
   when a `domain/` folder imports the framework or Prisma, when a module imports another module's
   internals instead of its service, or when anything outside the ledger module writes ledger or
   balance tables.

## Consequences

- Authentication, roles, audit, outbox, document numbering and the console shell start as proven
  code rather than new code: roughly a week of the six-week plan goes to the domain instead.
- Two of the maintainer's products share one stack and one set of conventions, which makes both
  easier to maintain and easier to evaluate together.
- Copied code can drift from Cwork. That is accepted for v1; extracting a shared package is worth
  revisiting only if a third project needs the same pieces.
- PaynEat POS's `CODING_STANDARDS.md` (Express and Flutter) does not apply here; Cwork's module and
  domain conventions do, as written into this repository by the walking-skeleton ticket.
- Prisma's convenience is available everywhere except the one place where it could silently break a
  ledger invariant.

## Alternatives considered

- **Express + Kysely** (the first choice in the design session). Superseded before any code was
  written: it would rebuild authentication, permissions, audit, outbox and the console shell that
  Cwork already has, and its main advantage — explicit SQL for the ledger — is kept by rule 4.
- **Prisma everywhere, including ledger posting.** Rejected: row locks and all-or-nothing posting
  must be visible in the code that does them.
- **A shared npm package extracted from Cwork now.** Rejected for v1: versioning a package across two
  repositories costs more than it saves within six weeks.

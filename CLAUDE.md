# Instructions for Claude Code in this repository

PaynEat ERP is the supply-side ERP for a vertically integrated restaurant chain: procurement,
its own processing plant, distribution to branches, and branch consumption fed by
[PaynEat POS](https://github.com/SuruchBoss/PaynEat). Read these before changing anything:

- [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — the only vocabulary for identifiers, specs, tickets and UI text.
- [`docs/adr/`](docs/adr/README.md) — why the system is shaped the way it is. Do not contradict an
  accepted ADR in code; if one is wrong, propose a new ADR that supersedes it.

Several Claude Code sessions work on this repository at the same time, some unattended. Most of
the rules below exist to stop them from duplicating or overwriting each other's work.

## Issue tracker and triage labels

- **Tracker:** GitHub Issues on `SuruchBoss/PaynEat-ERP`. Work that has to happen inside PaynEat POS
  follows **that** repository's convention: ticket files in its `docs/tickets/` (tickets 24–26 are the POS
  side of this ERP's first release), linked from the ERP issue that needs them. The same dev session works
  in both repositories; each repository's own `CLAUDE.md` applies inside it.
- **Labels (the triage vocabulary):**

  | Label | Meaning |
  |---|---|
  | `spec` | A parent specification. Never implemented directly; it is broken into tickets. Do not close or edit it while implementing a ticket. |
  | `ready-for-agent` | A ticket any session may claim and implement without asking anyone. |
  | `ready-for-human` | Needs a decision or input from the maintainer before anyone can start. |
  | `needs-triage` | New and not yet assessed. Not claimable. |
  | `in-progress` | Claimed by a session. Nobody else may start it. |
  | `blocked` | Waiting on another issue listed in its "Blocked by" section. |

- **Blocking edges** are written in each ticket's "Blocked by" section as issue references. A ticket
  is claimable only when every issue it lists is closed.

## Claiming work (mandatory)

1. Pick an open issue labelled `ready-for-agent`, not labelled `in-progress`, with no open blockers.
2. **Before writing any code**, add the `in-progress` label and comment `Claimed by <session link>`.
   Re-read the issue afterwards: if another claim landed first, back off and pick something else.
3. One issue, one branch, one pull request. Branch name: `issue-<number>-<short-slug>`. The PR body
   says `Closes #<number>`.
4. If you stop without finishing, remove `in-progress` and comment what is done and what is not.

## Definition of done

A ticket is done only when all of these hold:

- Behaviour is covered by **integration tests that call the real HTTP API against a real PostgreSQL**
  database. Unit tests for pure domain rules are welcome in addition, never instead.
- The demo seed (the fictional fried-chicken chain: one plant, three branches, two suppliers) still
  builds the whole scenario with one command, extended if the ticket adds something demo-able.
- `README.md` **and** `README.th.md` describe what now works, in the same commit.
- Any new domain decision is recorded as an ADR in **both** languages (`NNNN-slug.md` and
  `NNNN-slug.th.md`) and indexed in `docs/adr/README.md`.
- CI is green. Never skip, disable or weaken a test to get there.

## Merging

- **The dev session merges its own pull requests** once the definition of done holds and CI is green
  on the latest commit. Use **squash merge**, so `main` has one commit per issue, titled
  `<issue title> (#<issue number>)`. Before merging, bring the branch up to date with `main` and wait
  for CI to pass again.
- **Wait for the product owner's review before merging** only when a pull request:
  - changes a contract: anything under `contracts/`, or `docs/TELEMETRY.md` beyond what its issue
    already authorises;
  - adds or changes an ADR;
  - deliberately departs from its issue's acceptance criteria. Say so in the PR body; do not bury it.

  Ask on the PR by commenting `@product-owner review requested` and naming the reason.
- After merging, comment on the issue with what shipped and anything deferred. The product owner checks
  closed issues against their acceptance criteria. A gap becomes a new issue linked to the old one; the
  closed issue is not reopened.
- Never merge with red or pending CI, never bypass branch protection, and never merge someone else's
  pull request.

## Languages

- Code, identifiers, commit messages, issues and pull requests: **English.**
- `README.md` / `README.th.md` and every ADR: **English and Thai, kept in sync in the same commit.**
- UI text goes through i18n from the first screen (Thai and English). Never hard-code UI strings.
- New domain terms go into `docs/GLOSSARY.md`, with the Thai term, before they are used anywhere.

## Domain rules that must never be broken

These come from the ADRs; they are repeated here because violating them silently is the easiest
way to make this ERP untrustworthy.

- Ledger entries are **never updated or deleted**. Corrections are reversal documents. (ADR-0003)
- Posting writes all of a document's entries in **one transaction**, after locking the balance rows
  of every lot it touches, or writes nothing. (ADR-0003)
- Plant, warehouse and in-transit stock **never goes negative**; branch stock may, and is flagged.
  A POS sale is never refused because of stock. (ADR-0003)
- Lots are consumed **FEFO**, and consumption carries the cost of the lot it takes. (ADR-0004)
- Expired lots cannot be issued or transferred. Recalls report **candidate lots**, never a single
  lot the system cannot know. (ADR-0006)
- Nobody approves a document they created; enforce it in the service layer. (ADR-0008)
- Tolerances, thresholds and shelf lives are **configuration**, never constants in code. (ADR-0007)
- The ERP never reads or writes the POS database, and vice versa. (ADR-0002)
- Never present an estimate, suggestion or inference as a fact in the UI, an API response or a report.

## Editions (ADR-0015)

- v1 is **entirely Community**. `ee/` exists but holds only its license (Elastic License 2.0) and a
  README. Do not write Enterprise code until the product owner publishes an issue labelled for it.
- The core **never imports from `ee/`** (`check:architecture` rule `core-never-imports-ee`), the
  ledger rule applies inside `ee/` too, and an expired license key never blocks core work or data
  access.
- Never move behaviour from Community into `ee/`, and never put food safety, data integrity, basic
  security, data export or the upgrade path behind a key.

## Licensing

- Every source file starts with `// Copyright 2026 Suruch Chakrapeesirisuk` and
  `// SPDX-License-Identifier: Apache-2.0` (`Elastic-2.0` under `ee/`), in the comment syntax of its type.
  `node scripts/license-headers.mjs --fix` (from the repository root) adds it; CI's "License headers"
  job fails without it. Applied migrations are exempt and never edited.
- Outside contributions (pull requests from forks) are signed off under the DCO (`CONTRIBUTING.md`).
  A dev session does not sign off: a sign-off is a person's statement.

## Observability (ADR-0011)

Every system in the ecosystem must be investigable by SherWhyve from what it records.
The exact log fields, labels, event names and metrics are the contract in
[`docs/TELEMETRY.md`](docs/TELEMETRY.md); follow it rather than inventing names.

- Log as structured JSON with a string `severity` and a plain `labels` object (Google Cloud keys only
  with `LOG_FORMAT=gcp`). Every request, posting and integration event carries a **correlation id**
  (`x-request-id`; the idempotency key for anything from the POS).
- Every refusal of a posting logs and counts the rule that refused it.
- When you build a flow, add its health metrics (backlog age, received / duplicated / rejected counts,
  failures by rule).
- Never put secrets, tokens or personal data in logs or metric labels.

## Stack

NestJS 11 + Prisma + PostgreSQL 16 in `backend/`, React 19 + Vite in `web/`, shared POS contracts in
`contracts/` — aligned with [Cwork](https://github.com/SuruchBoss/Cwork), see
[ADR-0010](docs/adr/0010-backend-and-web-stack.md). In short:

- Business rules are pure functions in `modules/<name>/domain/`: no Prisma, no NestJS, no clock
  unless injected.
- A module owns its tables; other modules call its service, never its repository or Prisma models.
- **Only the ledger module writes ledger and balance tables, and only with raw SQL inside one
  transaction.** Everything else may use Prisma normally.
- Infrastructure copied from Cwork (auth with MFA, permissions, audit, outbox, sequences, job locks,
  console shell) keeps its structure; adapt it, do not rewrite it.

### Gates (all must pass before every commit; CI runs every one on each push and pull request)

Run inside `backend/`, after `npm ci` and `npx prisma generate`:

| Gate | Command |
|---|---|
| Format | `npm run format:check` (fix with `npm run format`) |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit tests (pure domain rules; need no database or configuration) | `npm test` |
| Architecture check (ADR-0010: `domain/` purity, module boundaries; ADR-0015: core never imports `ee/`) | `npm run check:architecture` |
| End-to-end tests against a real PostgreSQL 16 | `E2E_DATABASE_URL=postgresql://…/payneat_erp_test npm run test:e2e` |
| Build | `npm run build` |

Run inside `web/` (the admin console), after `npm ci`:

| Gate | Command |
|---|---|
| Format | `npm run format:check` (fix with `npm run format`) |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Tests: Vitest + Testing Library + axe, the TH/EN catalogue parity check and the scan for hard-coded UI text | `npm test` |
| Production build | `npm run build` |

- The end-to-end run migrates, **wipes** and seeds its database first, so it refuses a database
  whose name has no `test` in it (`E2E_ALLOW_NON_TEST_DB=1` overrides, deliberately).
- The demo seed is `npm run db:seed`; it is idempotent, and the end-to-end suite runs it.
- CI also runs `docker compose up` exactly as the README's "Try it" section tells a person to, and
  checks `/health` (directly and through the console's nginx), the console's page and security
  headers, the logs and that metrics are not published.
- Console text goes through `t()` with keys from `web/src/i18n/messages/th.ts`; `en.ts` is typed
  against it. A string written straight into JSX, or a key missing from either language, fails
  `npm test`.
- Logging goes through `TelemetryLogger` only (`console.*` is a lint error in `src/`); new flows add
  their events and metrics per `docs/TELEMETRY.md`.
- Every route is authenticated unless it says `@Public()`, and every route that touches data declares
  `@RequirePermissions(...)` (#4). A new permission goes into `core/security/permissions.ts`, is given
  to the roles ADR-0008 says should have it, and is mirrored in `web/src/lib/access.ts`.
- The end-to-end suite supplies its own test-only JWT secrets and encryption key when the environment
  has none; signing in as the demo admin uses the published second-factor secret
  (`test/utils/auth.ts`).

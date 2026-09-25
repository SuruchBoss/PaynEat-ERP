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

- v1 is **entirely Community**. Do not create `ee/` or write Enterprise code until the product owner
  publishes an issue labelled for it.
- When `ee/` exists: the core **never imports from `ee/`** (the architecture check enforces it), the
  ledger rule applies inside `ee/` too, and an expired license key never blocks core work or data
  access.
- Never move behaviour from Community into `ee/`, and never put food safety, data integrity, basic
  security, data export or the upgrade path behind a key.

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

The walking-skeleton ticket defines the exact lint, typecheck, unit, end-to-end and
architecture-check commands. They will be listed here, and all of them must pass before every commit.

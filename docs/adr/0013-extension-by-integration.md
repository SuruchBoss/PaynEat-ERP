# ADR-0013: Extension by integration, not by in-process plugins

- **Status:** Accepted; applies to third-party code — first-party Enterprise code in `ee/` is covered by [ADR-0015](0015-editions-community-and-enterprise.md)
- **Date:** 2026-09-25
- **ภาษาไทย:** [0013-extension-by-integration.th.md](0013-extension-by-integration.th.md)

## Context

Every chain has needs this project will not build: a particular accounting product, a delivery
aggregator, a supplier portal, a report only one finance team wants. An open-source ERP that cannot
be extended forces those chains to fork it, and a fork no longer receives upgrades.

The familiar answer is a module or plugin system in the style of Odoo: third-party code loaded into
the ERP's own process, able to add tables, screens and behaviour. That model has costs that fall
directly on this project's invariants:

- **The ledger.** Stock balances are an append-only ledger posted only by the ledger module in raw
  SQL, under row locks taken in a consistent order (ADR-0003, ADR-0010). Code running in-process with
  the same database connection can write those tables directly, and a single such plugin makes every
  balance in the system untrustworthy.
- **Upgrades.** Level 2 in ADR-0012 means upgrades that never break data. A plugin that depends on
  internal classes or table shapes breaks on the next refactor, and the maintainer must then either
  stop refactoring or break other people's installations.
- **Timing.** A plugin API freezes internal interfaces. Freezing them before the first release has
  real users would lock in the guesses of week one.
- **Scope.** ADR-0012 places a module system at level 3, which is not a target until a contributor
  community exists.

The ecosystem already integrates this way: the POS, Cwork and SherWhyve are separate systems joined by
versioned contracts (ADR-0002, ADR-0011). An add-on can be one more participant on the same terms.

## Decision

1. **The ERP is extended from outside, through three contracts:**

   | Contract | What it gives an add-on |
   |---|---|
   | **Public versioned API** | Read master data, balances, lots and posted documents; create draft documents that still go through the ERP's own approval and posting rules. Versioned by path (`/api/v1/...`), with a documented deprecation period before a version is removed |
   | **Scoped API tokens** | A token belongs to an integration, not a person, and carries explicit scopes (for example `items:read`, `documents:draft`). No scope allows posting, approving, or anything the roles in ADR-0008 reserve for a person. Tokens are revocable and every call is attributed to the integration in the audit trail |
   | **Outbound webhooks** | Posted-document and master-data events delivered from the same transactional outbox the POS contract uses: signed, retried with backoff, carrying an idempotency key and a contract version, so a receiver can process each event exactly once |

2. **No in-process plugins.** The ERP does not load third-party code, and add-ons have no database
   access. The ledger, costing and posting rules stay under the ERP's sole control.
3. **Add-ons are separate services**, in any language, deployed and upgraded on their own schedule.
   They must follow the telemetry contract (`docs/TELEMETRY.md`) if they want to be observable in the
   ecosystem, and they are identified by their token, not by a human login.
4. **Timing.** These contracts are built after the first release, once the internal model has been
   exercised by the end-to-end path. The POS contract (ADR-0002) is the first instance of the pattern
   and shapes the rest.
5. **Revisit** an in-process extension model only if a contributor community forms (ADR-0012 level 3),
   and then as a new ADR that explains how the ledger invariant survives it.

## Consequences

- Upgrades cannot be broken by third-party code, because none runs inside the ERP. Only the public
  API contract has to stay stable, and it is versioned explicitly.
- Every change made by an add-on goes through the same draft → approve → post path as a person's, so
  segregation of duties (ADR-0008) and the ledger invariant (ADR-0003) hold without exceptions.
- Add-ons are less powerful than Odoo modules: they cannot add screens to the web console, add fields
  to core documents, or change how posting works. A need that genuinely requires that is a feature
  request for the ERP itself, judged by the ADR-0012 scope question.
- The existing outbox gains a second consumer type. Its design (idempotency keys, versioned payloads,
  retry) must stay general enough for webhooks, not only for the POS.
- The public API needs its own documentation (an OpenAPI description generated from the code) and its
  own tests of backward compatibility between versions, which becomes part of the level-2 release
  discipline.

## Alternatives considered

- **In-process module system (Odoo-style).** Rejected for now: it lets outside code bypass the ledger
  and costing rules, turns every internal refactor into a breaking change, and is level-3 scope that
  needs a community which does not yet exist.
- **Scripting hooks inside the ERP (user-supplied scripts run on events).** Rejected: the same trust
  problem as plugins in a smaller form, plus a sandbox to secure and maintain.
- **Direct read-only database access for integrators.** Rejected: table shapes would become a public
  contract, blocking schema changes, and it bypasses the audit trail. Reporting needs are met by the
  API and, later, by exports.
- **No extension story at all.** Rejected: it leaves forking as the only option, and forks do not
  receive fixes or upgrades, which works against level 2.

# ADR-0002: System boundaries and integration with PaynEat POS

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0002-system-boundaries-and-pos-integration.th.md](0002-system-boundaries-and-pos-integration.th.md)

## Context

PaynEat POS already exists as its own repository with its own menu, ingredient and stock
management, and is useful to a single restaurant with no ERP at all. A chain needs one place that
owns items, recipes, suppliers and branches, and needs every sale to reach that place reliably even
when a branch's internet connection drops for hours.

## Decision

### Separate systems, separate repositories

PaynEat ERP lives in its own repository and runs as its own service against its own PostgreSQL
database on a central server. It never reads or writes the POS database, and the POS never reads or
writes the ERP database. They communicate only through a versioned API and versioned event schemas.

### One system of record per kind of data

| Data | System of record | The other system |
|---|---|---|
| Items, units, conversions, shelf life | ERP | POS mirrors what it needs |
| Menu items, prices, menu recipes, modifier recipes | ERP | POS mirrors; read-only in connected mode |
| Suppliers | ERP | — |
| Branches (as locations) | ERP | POS receives branch identifiers |
| Orders, payments, shifts, tax invoices | POS | ERP receives sales events only |
| Branch stock balance | ERP | POS keeps a mirror only to show "sold out" |

### The POS keeps working without the ERP

A POS instance runs in **standalone mode** by default, exactly as it does today. Registering it
with an ERP switches it to **connected mode**, in which its menu, recipe and ingredient screens
become read-only mirrors. A restaurant that downloads only the POS loses nothing.

### Sales flow POS → ERP through an outbox

- In the same database transaction that records a sale, the POS writes a **sales event** per sale
  line to an outbox table: menu item, quantity **or weighed weight** (the POS already sells by
  weight), modifiers, branch, time, and an **idempotency key**.
- A background sender drains the outbox to the ERP API with retries. The existing POS offline queue
  covers the gap when the branch is offline.
- The ERP applies each idempotency key exactly once and turns sale lines into theoretical usage
  using the menu and modifier recipes **in effect at the time of sale**. Recipe explosion happens in
  one place, the ERP, so costing and theoretical-versus-actual usage have one source.
- The POS never refuses a sale because of stock; see ADR-0003 on negative branch stock.

### Master data flows ERP → POS by version pull

Every master data change increments a version. A POS instance asks for changes since the last
version it applied. Pulling, not pushing, means an instance that was offline for a day simply
catches up.

### Machine identity

Each POS instance is registered in the ERP and receives its own machine credential. One instance
may serve several branches (the POS already supports multiple branches); the ERP tells it which
branch identifiers it serves. User accounts stay separate in each system in v1; there is no single
sign-on.

### Contracts are tested on both sides

The API and event schemas are published as versioned files. Both repositories run contract tests
against them, so a change that would break the other side fails CI on the side that made it.

## Consequences

- The integration layer is a first-class deliverable, not glue: the outbox, idempotency and version
  pull are among the things this project is meant to demonstrate.
- The POS needs its own changes (outbox, connected mode, read-only master data screens). They are
  tracked as issues in the POS repository and land in week 4 of the first release, after the
  contract is fixed in week 1.
- Near-real-time stock at the plant depends on the outbox draining; a branch offline for a day
  shows a day-stale consumption until it reconnects. That is accepted and visible.

## Alternatives considered

- **One repository and one database for POS and ERP.** Rejected by the product owner in favour of
  demonstrating a real integration boundary, which is how POS and ERP are deployed in industry.
- **The POS writing directly into the ERP database.** Rejected outright: it would make the
  separation meaningless and couple both schemas forever.
- **End-of-day batch upload (a Z-report-shaped summary).** Rejected: the plant would plan against
  yesterday's consumption, and a failed upload would lose a whole day at once.
- **The POS exploding recipes and sending ingredient consumption.** Rejected: costing would depend on
  whichever recipe version each POS happened to hold.

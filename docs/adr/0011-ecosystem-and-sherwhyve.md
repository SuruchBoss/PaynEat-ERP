# ADR-0011: One ecosystem — PaynEat POS, PaynEat ERP, Cwork and SherWhyve

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0011-ecosystem-and-sherwhyve.th.md](0011-ecosystem-and-sherwhyve.th.md)

## Context

Four projects by the same maintainer now touch the same restaurant chain from different sides:

| Project | What it is | Visibility |
|---|---|---|
| [PaynEat POS](https://github.com/SuruchBoss/PaynEat) | Point of sale for branches; works on its own | Public, Apache 2.0 |
| PaynEat ERP (this repository) | Supply-side ERP: procurement, plant, distribution, stock, cost | Public, Apache 2.0 |
| [Cwork](https://github.com/SuruchBoss/Cwork) | HR information system: people, attendance, leave, payroll | Public, Apache 2.0 |
| SherWhyve | AI incident investigator for support and development teams: reads logs, metrics and cluster state through read-only checks and returns ranked, evidence-backed hypotheses | Private |

Without explicit boundaries they would drift into overlapping each other. With them, they compose
into one ecosystem where each system does one job and the others rely on it.

## Decision

### 1. Each system owns one domain and is the system of record for it

| Data or responsibility | Owner |
|---|---|
| Orders, payments, shifts, tax invoices at a branch | PaynEat POS |
| Items, recipes, suppliers, locations, stock, lots, cost, planning | PaynEat ERP |
| Employees, attendance, leave, payroll, labour cost per cost centre | Cwork |
| Investigating technical incidents in the systems above | SherWhyve |

### 2. One integration style across the ecosystem

No system reads another's database. Systems integrate through versioned APIs and versioned events,
delivered from a transactional outbox with idempotency keys — the pattern PaynEat ERP uses with the
POS (ADR-0002) and Cwork already uses internally. **Location codes are the shared join key:** a
branch or plant has the same stable code in the ERP, in the POS, and as a Cwork work location.

### 3. Every system is investigable (SherWhyve, role A — from the first ticket)

SherWhyve can only explain what a system records. PaynEat ERP therefore treats observability as a
contract, starting with the walking skeleton:

- **Structured JSON logs** on every request, posting and integration event, carrying a
  **correlation id** that follows one business flow across systems: a sale's idempotency key from
  the POS outbox to the ERP ledger entry it produced, a document number from draft to posting.
- **Metrics for integration and posting health:** age of the oldest undelivered outbox event, sales
  events received, duplicated and rejected, postings attempted and refused (with the refusal rule
  as a label), master-data pulls per POS instance.
- **No secrets or personal data** in logs or metric labels.

A question such as *"sales from branch 2 stopped reaching the ERP at two o'clock"* is then answerable
by SherWhyve from evidence. SherWhyve's live connectors target Google Cloud (Cloud Logging, Cloud
Monitoring, Kubernetes); live use requires the ERP to run there. Elsewhere, recorded cases can be
replayed through SherWhyve's fixture-backed connectors.

### 4. The ERP's business analyst follows SherWhyve's method, not its code (role B — after v1)

An ERP has its own incidents: yield falls from 70 % to 62 %, a branch uses 12 % more chicken than
its recipes say, a piece's cost jumps, a delivery arrives warm. After the first release, the ERP
gains a **variance investigator** built on the principles SherWhyve proved:

- It may only call **read-only ERP operations defined at the schema level**, so "it cannot change
  anything" is a property of the code, not an instruction in a prompt.
- It answers with **ranked hypotheses, each citing evidence** (ledger entries, lots, documents,
  inspections) from a **complete trace** of the checks it ran.
- **"The data is not enough, and here is what is missing" is a valid answer.** It never presents an
  inference as a fact.
- It is **evaluated against recorded cases** before release, with a go/no-go threshold.

The forecasting and purchase-timing agent deferred in ADR-0009 builds on the same foundation, as
does the tool-calling-only rule already used by PaynEat POS's AI assistant.

**No SherWhyve code is copied into this repository.** SherWhyve is private; this repository is public
under Apache 2.0, and copying would publish it. This changes only if SherWhyve's core is itself
open-sourced, which would be recorded in a new ADR.

## Consequences

- The walking-skeleton ticket includes logging and metric conventions, and later tickets add the
  metrics for the flows they build. Retrofitting correlation ids across a running integration would
  be far more expensive than starting with them.
- Public documentation names SherWhyve and its role but does not link to it while it is private.
- The four projects can be evaluated together as one coherent body of work, while each remains
  usable on its own.

## Alternatives considered

- **Embedding SherWhyve inside the ERP as its analyst.** Rejected: different users (operations and
  finance rather than support engineers), different evidence (ledger and documents rather than logs),
  and it would publish private code.
- **Adding observability after the first release.** Rejected: the POS-to-ERP flow would ship
  without the ids needed to follow a sale end to end.
- **Leaving the projects independent with no stated boundaries.** Rejected: overlap (two sources for
  employees, locations or labour cost) is exactly what an ERP exists to prevent.

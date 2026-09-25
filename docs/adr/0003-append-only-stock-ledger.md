# ADR-0003: Inventory is an append-only ledger of posted documents

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0003-append-only-stock-ledger.th.md](0003-append-only-stock-ledger.th.md)

## Context

The simplest stock model is a `quantity` column that is incremented and decremented — which is what
PaynEat POS does for a single restaurant. In an ERP that model cannot answer the questions that
matter: why is this balance what it is, what did we hold on a past date, which receipt did this
stock come from, and who changed it. Auditors, recalls and period-end costing all depend on those
answers.

## Decision

1. **Every change to stock is a ledger entry.** An entry records item, lot, location, signed
   quantity in the base unit, optional secondary quantity (ADR-0005), unit cost, the posting
   document, the user who posted it, and the posting time. Entries are **never updated or deleted.**
2. **Balances are derived.** On-hand per item, lot and location is the sum of entries. A snapshot
   table may cache balances for speed; it is rebuilt from the ledger and the ledger wins on any
   disagreement.
3. **Only documents write the ledger.** Receipts, production orders, transfers, adjustments and
   returns start as drafts, which are editable and affect nothing. **Posting** writes all of a
   document's entries in one transaction or none of them.
4. **Posted documents are immutable. Corrections are reversals.** A mistake is fixed by posting a
   reversal document that exactly negates the original, then posting a correct document. Both
   remain visible.
5. **Negative stock depends on the location type.**
   - **Plant, warehouse, in-transit: never negative.** Posting a document that would take any lot
     below zero is rejected. Every movement at these locations is backed by a document, so a
     negative balance can only mean an error.
   - **Branch: may go negative, and is flagged.** Branch consumption comes from sales that have
     already happened; the physical stock was in the cook's hands, so the system follows reality.
     A negative branch balance raises a flag that asks for a stock count.
6. **Concurrent postings cannot oversell a lot.** Posting locks the balance rows of every lot it
   touches (`SELECT … FOR UPDATE` in a consistent order) before checking and writing, so two
   documents cannot both take the last kilogram of the same lot.
7. **Period close is per location.** Each location has a closed-until date; a posting dated on or
   before it is rejected. Reopening a period is an admin action that is itself audited.

## Consequences

- Any balance on any past date can be reproduced, and every unit of stock can be traced to the
  document and the person that moved it — the ledger is its own audit trail for stock.
- Corrections are slower than editing a number, by design.
- Storage grows with activity rather than with the item count. For a chain this is modest;
  snapshots keep reads fast.
- Posting logic must be written against explicit SQL transactions and row locks, which constrains
  how the data-access layer is used for the ledger (see the backend stack ADR).

## Alternatives considered

- **A mutable quantity per item and location.** Rejected for the reasons in Context.
- **Allowing negative stock everywhere.** Rejected: at a plant it hides receiving and production
  errors instead of surfacing them.
- **Blocking branch sales at zero stock.** Rejected: a system that refuses to sell food the cook is
  holding will be bypassed, and then its numbers are worse than useless.

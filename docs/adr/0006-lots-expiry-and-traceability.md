# ADR-0006: Lots, expiry, and honest traceability

- **Status:** Accepted; decision 1 clarified 2026-09-26 (opening balances, #7)
- **Date:** 2026-09-25
- **ภาษาไทย:** [0006-lots-expiry-and-traceability.th.md](0006-lots-expiry-and-traceability.th.md)

## Context

When a supplier recalls a batch, a restaurant chain has to answer two questions fast: where did that
batch go, and which dishes could it be in. The plant can know exactly which lots it consumed. A
branch usually cannot: the POS records "three drumsticks sold", not which bag the cook opened, and
the POS is deliberately lot-unaware so that it still works on its own (ADR-0002).

## Decision

1. **Lots are created only by goods receipts and production outputs.** Each lot has an item, an
   origin document, a unit cost (ADR-0004), and an expiry date computed as receipt or production date
   plus the item's shelf life.

   *Clarification (2026-09-26, #7):* the **opening balance** that brings existing stock into the system
   once, at go-live, also creates lots. That stock was received before the system existed, so its
   receipt cannot be recorded, and the opening balance is its origin document. Its cost and expiry are
   entered per line, because they are already known. After go-live, receipts and production outputs
   remain the only documents that create lots.
2. **Production records lot genealogy.** Every production output lot is linked to the input lots it
   consumed, with quantities. Forward and backward traces walk these links.
3. **Expired lots are blocked.** A lot past its expiry date cannot be issued, consumed by production,
   or transferred. It can only be written off with an adjustment.
4. **Branch consumption is allocated FEFO by the ERP.** Sales events carry no lot; the ERP assigns
   consumption to the branch's lots in FEFO order for costing and balances.
5. **Recalls report candidate lots, never false certainty.** A backward trace from a sale at a
   branch returns **every lot that could have been in use** there at that time — the lots with
   stock on hand at that branch in the window — together with how the ERP's FEFO allocation
   assigned it. The report states which parts are certain (plant genealogy, transfer documents)
   and which are inferred (branch consumption).

## Consequences

- A forward trace from a supplier lot to the branches that received it is exact, because every step
  is a posted document.
- A backward trace from a dish is exact up to the branch and bounded, not exact, after it. Claiming
  more precision than the data holds would be the fastest way to lose the trust of anyone who has
  run a recall.
- Exact branch-level traceability is possible later by scanning or selecting a lot when a pack is
  opened. It is an option to add, not something v1 pretends to have.

## Alternatives considered

- **Reporting FEFO allocation as if it were certain.** Rejected: it is false precision.
- **Requiring staff to scan a lot for every pack opened in v1.** Rejected for the first release: it
  adds work on the busiest part of the floor and changes the POS in a way standalone users do not
  need.

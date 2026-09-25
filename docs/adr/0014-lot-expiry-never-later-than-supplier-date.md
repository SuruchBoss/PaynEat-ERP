# ADR-0014: A lot's expiry is never later than the supplier's date

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0014-lot-expiry-never-later-than-supplier-date.th.md](0014-lot-expiry-never-later-than-supplier-date.th.md)

## Context

ADR-0006 computes a lot's expiry as its receipt or production date plus the item's shelf life, and
ADR-0007 records the supplier's expiry at every receipt. The two can disagree: a supplier may deliver
stock that was packed days ago, so the date printed on the pack is earlier than receipt date plus
shelf life. If the ERP kept the computed date, it would let food move after the date the supplier
guarantees, and the expiry block in ADR-0006 would protect nothing in exactly the case it exists for.

## Decision

1. **At a goods receipt, a lot's expiry is the earlier of** the receipt date plus the item's shelf
   life **and** the supplier's expiry recorded on the line. The lot keeps both dates so the reason is
   visible.
2. **A supplier date earlier than the computed date is an inspection finding.** The receipt line is
   out of tolerance and follows ADR-0007: a reason and an approval by someone other than the
   receiver. Short-dated stock can be accepted, but never silently.
3. **Production output lots** keep ADR-0006 unchanged: production date plus the output item's shelf
   life, **but never later than the earliest expiry among the input lots consumed**. Cutting a bird
   does not extend its life.
4. Transfers never change a lot's expiry (a transfer moves the same lot).

## Consequences

- The expiry block of ADR-0006 now holds against the date the chain is actually accountable for.
- Receiving screens must show both dates and which one the lot takes.
- The FEFO order (ADR-0004) uses the resulting expiry, so short-dated deliveries are used first.
- ADR-0006 is refined, not replaced: its rule remains the upper bound.

## Alternatives considered

- **Always use the computed date.** Rejected: it can be later than the supplier's guarantee.
- **Always use the supplier's date.** Rejected: suppliers do not always print one, and items the
  plant produces have no supplier date at all.
- **Reject short-dated deliveries outright.** Rejected: plants sometimes accept them deliberately
  (for immediate use); the approval step keeps that decision visible instead of impossible.

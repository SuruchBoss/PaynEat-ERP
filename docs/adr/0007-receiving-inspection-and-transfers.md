# ADR-0007: Receiving, inspection, and transfers

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0007-receiving-inspection-and-transfers.th.md](0007-receiving-inspection-and-transfers.th.md)

## Context

Chilled protein arrives at a plant from suppliers and leaves it for branches. At both hand-overs the
quantity can be short, the goods can be damaged, the temperature can be out of range, or the expiry
can be too close. If differences are absorbed silently, stock is wrong and nobody is accountable for
it.

## Decision

1. **One inspection model** is used at every receipt: a goods receipt from a supplier and a transfer
   receipt at a branch record the same things per line — counted quantity (and secondary quantity
   for variable-weight items, ADR-0005), receiving temperature, condition, and expiry.
2. **Tolerances are configured per item, never hard-coded:** maximum quantity variance in percent and
   maximum receiving temperature. Anything outside tolerance requires a reason and an approval by a
   role other than the receiver's (ADR-0008).
3. **Transfers go through in-transit.** Dispatch at the origin confirms the lots and quantities
   picked and moves them to an in-transit location. Receipt at the destination moves what arrived
   into the destination.
4. **Differences are documents, not disappearances.** Short or damaged quantity at a transfer
   receipt is either returned to the origin or written off, with a reason; it never stays in
   in-transit and never vanishes. Rejected supplier goods produce a return to supplier.
5. **Both ends are accountable.** The dispatching location confirms what left; the receiving location
   confirms what arrived; the difference between the two is visible on the transfer.

## Consequences

- Cold-chain temperatures are captured at the point where they matter, as data, not as a paper form.
- Stock in transit is visible at all times, so a truck's contents are never "nowhere".
- Receiving takes a little longer than typing a quantity. That is the cost of stock that can be
  trusted.

## Alternatives considered

- **Moving stock directly from origin to destination on dispatch.** Rejected: the destination would
  show stock it has not received.
- **Separate inspection models for suppliers and transfers.** Rejected: they record the same facts,
  and two models would drift.

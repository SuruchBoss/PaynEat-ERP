# ADR-0029: Requisitions: fulfilment follows what transfers dispatched, suggestions come in whole requisition units, and par misses are counted two ways

- **Status:** Accepted
- **Date:** 2026-10-10
- **ภาษาไทย:** [0029-requisitions-par-levels-and-par-misses.th.md](0029-requisitions-par-levels-and-par-misses.th.md)

## Context

ADR-0009 decides that a branch pulls stock from the plant with a requisition, that the screen
suggests each quantity from a par level, and that par misses must be visible so bad par levels show
up. ADR-0028 decides how transfers move the stock. Building requisitions (#15) leaves questions
those decisions do not answer:

- A requisition is fulfilled by one or more transfers. Is "partially fulfilled" something the
  requisition stores, and what happens to it when a transfer is cancelled or its dispatch reversed?
- The plant packs chicken in trays. Does a branch ask for 18 pieces or two trays?
- What exactly counts as a par miss, when the negative branch balance flag of #8 is a reading of
  stock on hand, not a record of when the balance went negative?
- Two people in logistics may prepare a transfer from the same requisition at once, and a branch
  may cancel it while they do.
- #15 asks for branch managers to act for their own branches only, but the ERP does not yet know
  which person belongs to which branch.

## Decision

1. **A requisition stores only draft, submitted or cancelled.** Partially fulfilled and fulfilled
   are read from the transfers created from it, never stored: a submitted requisition is partially
   fulfilled once anything was dispatched against it, and fulfilled once every line's dispatched
   quantity reaches what it requested. Only what dispatched transfers took out of the plant counts:
   a draft transfer plans and fulfils nothing, a cancelled one never existed, and a reversed dispatch
   (ADR-0028 decision 9) moved nothing, so the requisition goes back to where it was. A requisition
   writes no stock.
2. **The suggestion is a pure domain function**, `max(0, par − branch balance − quantity in transit
   to the branch)`, rounded up to a whole number of the item's requisition unit when it has one. The
   branch balance is the item's, all lots together, and may be below zero (ADR-0003): a negative
   balance raises the suggestion, because the shortfall is real. In transit to the branch is what
   dispatched transfers to it took out of their origin, neither received nor reversed. Each line keeps
   the suggestion as it was when the line was saved, next to what the person asked for; nothing
   recomputes it later.
3. **The requisition unit is item configuration.** An item may carry how many base units the plant
   packs and sends together (a tray of 10 pieces, a 2.5 kg bag). Like receiving tolerances it is the
   admin's configuration, not master data a POS mirrors, and takes no master data version. A
   requisition asks for whole requisition units; a transfer is not held to them, because logistics
   sends what it has.
4. **Par levels are per branch and item**, kept by the admin (`par_level:manage`), zero or more, in
   the item's base unit. An item without one gets no suggestion at that branch and can still be
   requested.
5. **Logistics fulfils with transfers created from the requisition.** Such a transfer goes from the
   requisition's supplying location to its branch for good (the service refuses a new route and the
   database refuses to store one), carries only items the requisition asks for, and is prefilled with
   what is outstanding: requested less dispatched and less what draft transfers already plan, never
   below zero. Logistics may send more or less than that. Creating the transfer locks the requisition
   in the same transaction and moves its revision on, so of two people preparing transfers at once
   the second is asked to reload instead of sending the outstanding quantity twice.
6. **A requisition is cancelled only before anything was dispatched against it**, with a reason. A
   draft transfer of it is cancelled first, by logistics; once a dispatch is reversed, the
   requisition can be cancelled again. Cancelling and creating a transfer queue on the requisition's
   row, so exactly one of them wins, and the database refuses a cancellation while a transfer of it
   is a draft or dispatched.
7. **The supplying location is the plant by default**: the company's one active plant when the
   person names none; otherwise they name a plant or warehouse.
8. **Par misses are counted two ways, per branch and item, over a period of business dates**
   (four weeks to today by default):
   - **Went below zero:** the item's balance at the branch, all lots together, is replayed document
     by document in business time, and on one business date in the order the documents were posted.
     Each time it goes from zero or more to below zero during the period counts once. This is the
     item-level reading of the #8 flag, which itself is not stored, so it is derived from the ledger
     rather than from a flag history that does not exist.
   - **Not dispatched in time:** a submitted requisition line needed by a date in the period that has
     passed, whose transfers dated on or before that date and not reversed dispatched less than it
     requested. A draft or cancelled requisition never misses.

   The report lists every branch and item with a par level even when it never missed, so a par level
   that works shows as one.
9. **Branch scoping is deliberately not in #15.** As for receiving transfers in #14, anyone holding
   `requisition:raise` (branch managers) may raise for any branch. Every branch step goes through one
   service-layer check of the requisition's branch, which #71 extends with the person's branch
   assignment; #71's scope includes requisitions. This departs from #15's acceptance criterion
   "`branch_manager` for their own branches only", by the product owner's decision.

## Consequences

- A requisition's status cannot fall out of step with its transfers: there is nothing to update when
  a transfer is cancelled or reversed.
- The suggestion a manager saw is on the record next to what they asked for, so a par level that is
  routinely overridden is visible as well as one that misses.
- A tray is a configuration value, not a unit of measure: stock, costs and transfers stay in the base
  unit (ADR-0005).
- The par-miss report replays branch entries each time it runs. It is fine at the size of a
  restaurant chain's branches; a long period over many years would need a stored history of the flag.
- Until #71 ships, the console shows every branch to every branch manager, and the API accepts their
  requisitions for any branch.

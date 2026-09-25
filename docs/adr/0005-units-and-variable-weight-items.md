# ADR-0005: Units of measure and variable-weight items

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0005-units-and-variable-weight-items.th.md](0005-units-and-variable-weight-items.th.md)

## Context

Suppliers invoice chicken by actual weight, the plant plans in birds ("cut 500 birds today"), and
branches count portions in pieces. Proteins and seafood have no fixed weight per piece. An ERP that
knows only one unit per item forces users to invent either the weight or the count. Full
catch-weight management — every movement carrying two independent quantities with per-piece
tolerances and pricing in either unit — is large enough that major ERPs ship it as a separate module.

Retrofitting a second quantity into an append-only ledger later is especially costly: historical
entries cannot be edited (ADR-0003), so they would stay without it forever.

## Decision

1. **Every item has exactly one base unit** in which it is valued and balanced (kg for whole
   chicken, piece for a drumstick).
2. **Purchase units convert to the base unit by a fixed factor** per item (case → kg).
3. **Items can be flagged variable-weight.** For those items, receipts and production record **both**
   the actual weight in the base unit **and** the piece count as a **secondary quantity**. The ERP
   derives the average weight per piece per lot for planning. Valuation always uses the base unit.
4. **The schema carries the secondary quantity from day one** on lots and ledger entries (nullable),
   even though only receipts and production use it in v1.
5. **Weighed POS sales are first-class.** The POS already sells menu items by weight; a weighed sale
   line arrives with its weight, and menu recipes can express consumption per kilogram sold.

## Consequences

- The chicken path works without anyone inventing numbers: receive 21.6 kg as 12 birds, produce
  pieces with measured output weight, sell by the piece or by weight.
- Deferred: per-piece weight tolerances, prices quoted per secondary unit, and secondary quantities
  on transfers and branch consumption. They can be added without migrating history.

## Alternatives considered

- **One unit per item, nothing else.** Rejected for real use: users would have to fake either
  weight or count, and the ledger would record the fiction.
- **Full catch-weight in the first release.** Rejected: it doubles the complexity of every document
  for a benefit the first release does not need.

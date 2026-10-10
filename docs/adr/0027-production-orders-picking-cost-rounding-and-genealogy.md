# ADR-0027: Production orders: one business date, FEFO picks and overrides, exact cost allocation, and genealogy on reversal

- **Status:** Proposed
- **Date:** 2026-10-10
- **ภาษาไทย:** [0027-production-orders-picking-cost-rounding-and-genealogy.th.md](0027-production-orders-picking-cost-rounding-and-genealogy.th.md)

## Context

ADR-0004 decides that a production order splits the cost of the input lots it consumes across its
outputs by the BOM's allocation ratios, and divides each share by the output's actual quantity to
give the output lot's unit cost. ADR-0006 decides that inputs are picked first-expired-first-out,
that expired lots are never used, and that every output lot is linked to the input lots it came
from. ADR-0014 caps an output lot's expiry at the earliest input lot's. Building production orders
(#13) leaves questions those decisions do not answer:

- A lot's unit cost is kept to six decimals (`NUMERIC(18,6)`, ADR-0019). Dividing a share of the
  input value by an output's quantity rarely ends there: 1,000 baht over 22 pieces is
  45.4545… a piece. Whatever is rounded, the output lots are then worth a little more or a little
  less than the input they consumed. Issue #13 asks that the sum of the output lot values equal
  the consumed input value exactly. With a six-decimal unit cost that cannot hold for every order.
- On which date is an order's stock consumed and produced, and against which date are lots
  expired?
- What may the plant supervisor change in the lots FEFO picks?
- How is yield measured for outputs counted in pieces?
- A posted order is corrected by reversal (#7). What happens to its genealogy?

## Decision

1. **One business date per order.** An order is raised on a business date (today by default, never
   later). Everything about it is judged on that date: the BOM version in force (the order records
   it), which lots have expired, the date its consumption and its output lots are posted on, and
   the output lots' expiry.
2. **The plan is scaled from the BOM.** The order states how much of the BOM's first input it
   plans to use ("500 kg of whole chicken"); every BOM line is scaled to that and rounded half up
   to its item's decimals. The planned outputs are the BOM's expected yield at that scale: a plan,
   shown as one, never posted.
3. **Lots are picked when the order is released, and the supervisor may change them.** Releasing a
   draft fixes its BOM version, plant and plan, and picks each input's lots FEFO from the plant's
   stock on the order's date (earliest expiry, then lot number). What FEFO cannot cover stays short
   and is shown. The supervisor may then take other lots and other quantities, never a lot that
   has expired on the order's date; the order records that its picks were changed. Whether the
   plant still holds enough is decided only when the order posts, under the balance locks
   (ADR-0003): plant stock never goes below zero.
4. **Yield is measured by weight, never estimated.** As in ADR-0026, a kg or g line weighs its
   quantity; a line counted in any other unit records its measured weight. Without it the order
   shows no actual yield and does not post. A variable-weight output records its piece count as
   well as its weight (ADR-0005).
5. **Cost allocation keeps every digit, and rounds once.** For each output:
   - its **allocated value** is the consumed input value × its ratio ÷ 100, kept exactly in an
     unbounded `NUMERIC`. Because the ratios add up to exactly 100.00 (ADR-0026), the allocated
     values add up to the input value to the last digit;
   - its **lot unit cost** is the allocated value ÷ its actual quantity, rounded half up to six
     decimals. That is the only rounding. Consumption of the lot later carries this cost, as
     ADR-0004 says;
   - its **rounding difference** is the allocated value less the lot's value (quantity × unit
     cost), kept exactly on the order's output line and shown on the order.

   So for every posted order, **Σ output lot values + Σ rounding differences = consumed input value
   exactly**, and each output's rounding difference is at most its quantity × 0.0000005. This is
   the rule issue #13 asks for ("any rounding remainder is assigned by a documented rule"), and it
   departs from the literal wording "the sum of output lot values equals the consumed input value
   exactly": the value rounding moves is not put into any lot, it is recorded beside the lots.
6. **An output with no actual quantity refuses the order.** It cannot carry a cost, so the order is
   refused (`zero_output_quantity`) rather than dividing by zero or moving its share to the other
   outputs. An output that really yielded nothing means the order did not follow its BOM: cancel it,
   or correct the BOM.
7. **One posting, one transaction.** The ledger module consumes the picked lots, creates one lot per
   output and writes the genealogy, all in one transaction or nothing. The order's lines are
   numbered inputs first, then outputs, so an output lot is numbered after them
   (MO-2026-00001/2 for the first output of a one-input BOM).
8. **Genealogy records what was measured.** Each output lot is linked to each input lot the order
   consumed, with the quantity the order consumed of that input lot as a whole. The ERP does not
   apportion it to outputs: which drumstick came from which bird is not known, and an apportioned
   quantity would be an estimate presented as a fact.
9. **A reversal keeps genealogy as history and drops it from traces.** Genealogy is append-only.
   When the order is reversed, its links stay, flagged as belonging to a reversed order; a trace
   follows only links of orders that stand. A reversal is refused like any other when an output
   lot has moved on since (it would go below zero at the plant).
10. **Poor yield is visible.** Each posted order fixes its measured and expected yield, and the
    latest standing order of each BOM is exposed as the metric `erp_production_yield_percent`.

## Consequences

- Lot values stay true to six decimals, the precision every other document and report already
  uses, and the order explains to the last digit where the input value went.
- An output lot's value is not exactly its allocated value: up to half a millionth of a baht per
  unit differs, recorded on the order. Reports that need the allocated value read the order.
- The supervisor can follow what the floor really did (another lot was closer, a lot was short)
  without the ERP pretending FEFO was followed, and without ever using an expired lot.
- Outputs counted in pieces need a scale at the plant to post.

## Alternatives considered

- **Widen the lot unit cost** (to twelve decimals, say). Fewer differences, never none: a third
  of a baht still has no exact decimal. Every lot, entry and report would change for no exact gain.
- **Store a value on each lot instead of a unit cost.** Exact, but consumption would then have to
  divide a lot's value by what is taken from it, which contradicts ADR-0004's "consumption takes
  the cost of the lot it takes" and moves the same rounding into every consumption.
- **Put the remainder into the last output's lot.** Makes the sum exact only by giving one lot a
  unit cost that is not its share ÷ its quantity, and still cannot when the remainder does not
  divide by that lot's quantity.
- **Apportion genealogy quantities to each output by ratio or weight.** Rejected: an estimate
  presented as a measurement.

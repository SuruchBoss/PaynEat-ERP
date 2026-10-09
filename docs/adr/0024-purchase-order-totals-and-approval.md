# ADR-0024: Purchase order totals round once per line, and the approval threshold compares the gross total

- **Status:** Accepted
- **Date:** 2026-10-05
- **ภาษาไทย:** [0024-purchase-order-totals-and-approval.th.md](0024-purchase-order-totals-and-approval.th.md)

## Context

Issue #10 builds purchase orders. A purchase order commits money, not stock, so it writes nothing to the ledger
(ADR-0003). Goods receipts (#11) will set each lot's cost from the order line (ADR-0004), so the cost a line
implies has to be computed once, exactly, and tested. ADR-0008 says a purchasing approver approves orders above a
threshold, and that nobody approves a document they created. ADR-0007 makes thresholds configuration, never
constants in code. ADR-0019 rounds unit conversions once, half away from zero.

The issue leaves several rules open, and each of them changes an amount someone pays or a cost a report shows:

- where rounding happens, and to how many decimals;
- what a line's cost per base unit is when VAT is or is not recoverable;
- which total the threshold compares, and what happens exactly at the threshold;
- what the threshold is before anyone has set it;
- what happens to an order an approver turns down;
- which conversion factor a line uses if the item's purchase unit changes later;
- where supplier goods can be delivered.

## Decision

1. **Money rounds once, per line, to 2 decimals, half away from zero.** A line's net is
   `round₂(quantity × price per purchase unit)`; its VAT is `round₂(net × rate ÷ 100)`; its gross is net + VAT.
   The order's totals are the sums of its rounded lines, never a recomputation from unrounded amounts, so the
   lines always add up to the order. A price has at most 4 decimals and a VAT rate at most 2, between 0 and 100.
2. **A line's cost per base unit is the price per purchase unit divided by the conversion factor, net of
   recoverable VAT**, rounded once to 6 decimals. When the VAT is recoverable it is not a cost and is left out;
   when it is not recoverable it is part of the cost:
   `round₆(price × (100 + (recoverable ? 0 : rate)) ÷ (100 × factor))`. It is computed from the price, not from
   the rounded line amounts, so it does not depend on the quantity ordered. Goods receipts take a lot's cost
   from it (ADR-0004).
3. **The approval threshold compares the order's gross total, VAT included.** That is the money the chain
   commits. An order whose gross total is **at or below** the threshold is approved automatically when it is
   submitted; above it, the order waits for a user holding `purchasing_approver`. An automatic approval is
   recorded as such, with the threshold that applied, and is audited and logged like any other approval.
4. **The threshold is a company setting maintained by `admin`**, in baht with at most 2 decimals, never
   negative, and every change is audited. Until it is first saved it is **0**, so every order waits for an
   approver: an installation that has not chosen a threshold does not approve anything on its own.
5. **Nobody approves or rejects an order they created**, whatever roles they hold (ADR-0008). The service
   refuses it, and the database refuses an approver equal to the creator.
6. **A rejected order is final.** The approver gives a reason; the purchasing officer raises a new order if one
   is still needed. After submission an order changes only by moving forward or being cancelled with a reason,
   and only before anything has been received against it. Drafts are the only editable state; orders are never
   deleted.
7. **A line keeps the conversion factor of its purchase unit as it was when the line was saved.** The amounts
   and the cost per base unit of an order never change because master data changed afterwards.
8. **Supplier goods are delivered to a plant or a warehouse**, never to a branch or to in-transit. Inactive
   suppliers, items and locations cannot be ordered from, ordered or delivered to.

## Consequences

- A goods receipt can set lot cost directly from the order line, and the cost of a recoverable-VAT purchase does
  not carry tax that the chain claims back.
- An order of 12 cases of 20 kg whole chicken at 1,284.00 baht, VAT 7% recoverable, is 15,408.00 net, 1,078.56
  VAT and 16,486.56 gross; 240 kg at 64.200000 baht per kilogram. With the VAT not recoverable the cost is
  68.694000 per kilogram. These are unit tests in `purchase-order-rules.spec.ts`.
- A fresh installation sends every order to an approver until `admin` sets a threshold. The demo seed sets
  20,000.00 baht.
- An order cannot be corrected after submission; the cost of a mistake is cancelling it and raising another.
- A user holding both `purchasing` and `purchasing_approver` can approve other people's orders but never their
  own.

## Alternatives considered

- **Round the order total once from unrounded lines.** The lines would not add up to the total printed on the
  order. Rejected.
- **Compare the net total to the threshold.** It understates the money committed when VAT is not recoverable,
  and makes the same order's approval depend on its VAT treatment. Rejected.
- **Approve automatically only below the threshold.** The issue says "at or below"; a threshold is the largest
  amount a purchasing officer may commit alone.
- **A default threshold above 0.** Any number chosen in code would be a constant pretending to be configuration
  (ADR-0007), and would let orders through on an installation whose owner never decided.
- **Let a rejected order go back to draft.** It would make the history of what was submitted, rejected and
  re-submitted harder to read, and a reason to reject is usually a reason to start again.
- **Store the threshold on the company row.** An installation has no company row until the demo seed or a
  later setup creates one, so the setting lives in its own single-row table.

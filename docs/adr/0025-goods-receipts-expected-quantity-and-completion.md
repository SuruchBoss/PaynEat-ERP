# ADR-0025: Goods receipts: what a delivery is expected to bring, how much an order line may receive, and when an order is received

- **Status:** Proposed
- **Date:** 2026-10-09
- **ภาษาไทย:** [0025-goods-receipts-expected-quantity-and-completion.th.md](0025-goods-receipts-expected-quantity-and-completion.th.md)

## Context

ADR-0007 decides that every receipt is inspected with one model and that anything outside an item's
tolerances needs a reason and someone else's approval. ADR-0014 decides the expiry a received lot
takes. ADR-0004 and ADR-0024 decide its cost. Building goods receipts (#11) leaves questions those
decisions do not answer:

- Against what is the counted quantity of a delivery compared? An order is often delivered in
  parts, and chicken is delivered by weight, never exactly what was ordered.
- How much may be received against an order line, and how is that limit kept when two receipts
  post at the same moment?
- When is an order line, and an order, received? A line of 240 kg delivered as 238.4 kg will never
  reach 240 kg.
- Does the approver decide on the findings as the receiver submitted them, or as they would be
  recomputed later?
- In which unit does the receiver count?
- Are an item's tolerances master data that every POS mirrors?

## Decision

1. **The receiver counts in the order line's purchase unit or in the item's base unit.** Whole
   chicken ordered by the case is weighed in kilograms, with its birds counted (ADR-0005). Both the
   entered quantity and its base quantity are kept, converted once when the line is saved with the
   one conversion of ADR-0019.
2. **A delivery is expected to bring what is still outstanding on its order line:** ordered less
   what posted receipts have accepted. The inspection compares the counted quantity with that. A
   line received in two deliveries is therefore inspected against the rest, not against the whole.
3. **A receipt with no finding posts when it is submitted. A receipt with a finding waits for a
   purchasing approver who did not create it** (ADR-0007, ADR-0008). Every line with a finding, and
   every line with anything turned away, needs a reason. Turning goods away is not itself a finding:
   it needs a reason, not an approval.
4. **Findings are fixed when the receipt is submitted.** What each line expected and what was found
   are written on the line, and the approver decides on exactly that. A receipt that was clean when
   submitted is inspected again inside its posting; if another receipt has meanwhile changed what
   is expected and a finding appears, it is refused (`needs_approval`) and submitted again.
5. **An order line may accept at most what was ordered plus the item's variance limit**, or exactly
   what was ordered when the item has none. The limit is checked inside the posting transaction,
   after the order is locked: two receipts posted at once queue on that lock, and the second sees what
   the first accepted. The counted quantity may exceed it; what is accepted may not.
6. **An order line is complete when it has accepted what was ordered less the item's variance
   limit**, or what was ordered when there is none. An order is received when every line is
   complete, partially received as soon as anything has been accepted, and left as it was when a
   receipt accepted nothing at all, so it can still be cancelled.
7. **Posting creates one lot per accepted line** at the order line's cost per base unit (ADR-0004,
   ADR-0024), with the expiry of ADR-0014. The lot keeps both dates. Goods the supplier says have
   already expired cannot be accepted: they are turned away in full.
8. **What is turned away becomes one return to supplier per receipt**, numbered `RTS-YYYY-NNNNN`,
   created by the posting with each line's reason, never changed, and with no ledger entries. The
   order line records what was returned beside what was received.
9. **An item with a temperature limit is measured at the dock.** An unmeasured delivery cannot be
   shown to be cold enough, so it is refused rather than judged.
10. **Receiving tolerances are configuration the `admin` maintains, not master data.** They are set
    on their own endpoint, audited, and take no master data version: a POS never receives them, and
    the POS contract does not change.

## Consequences

- A partial delivery is a finding when it falls short of what is outstanding by more than the
  variance limit. The plant sees it while typing, and an approver accepts the short delivery
  deliberately instead of it passing unnoticed.
- Chicken delivered by weight completes its order line within tolerance; nobody waits for the last
  1.6 kg of a bird.
- What an approver approved is what posts, except for the limits that no approval can lift: an order
  line's receivable limit and an expired lot.
- A posted receipt is not reversed in this release. Correcting one needs a reversal that also takes
  back what it recorded on the order, which is left to a later issue; the database refuses lowering
  an order line's received quantity until then.
- Transfer receipts will use the same inspection function unchanged (`core/receiving/domain`), with
  what was dispatched as the expected quantity.

## Alternatives considered

- **Compare every delivery with the whole ordered quantity.** Rejected: the second part of a split
  delivery would always look like an over-delivery.
- **Let receipts post without limit and flag over-receipts afterwards.** Rejected: stock and the
  order would both be wrong until someone noticed, and ADR-0007 asks for differences to be decided,
  not absorbed.
- **Recompute findings when the approver approves.** Rejected: the approver would approve something
  other than what they read.
- **Keep tolerances in the item's master data.** Rejected: every POS would receive a new master data
  version, and a contract change, for a setting only the dock uses.

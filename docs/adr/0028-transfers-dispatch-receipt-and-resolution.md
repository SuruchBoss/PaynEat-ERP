# ADR-0028: Transfers: dispatch and receipt are two documents, one receipt posts, and every dispatched quantity is accepted, returned or written off

- **Status:** Proposed
- **Date:** 2026-10-10
- **ภาษาไทย:** [0028-transfers-dispatch-receipt-and-resolution.th.md](0028-transfers-dispatch-receipt-and-resolution.th.md)

## Context

ADR-0007 decides that transfers go through an in-transit location, that the receipt at the
destination uses the same inspection as a goods receipt, and that a difference between what left
and what arrived is either returned to the origin or written off, never left in transit. ADR-0003
decides that a document posts all of its entries at once, and that a posted document never changes.
Building transfers (#14) leaves questions those decisions do not answer:

- A transfer moves stock twice, at dispatch and at receipt, on different days, by different people.
  Is that one document or two?
- Two people at a branch could each start receiving the same delivery. Which one counts?
- What does the receipt's inspection compare against, and can a transfer be "short dated"?
- What exactly must add up so that nothing stays in transit?
- Who approves what? ADR-0007 says a difference needs an approval; the glossary says a write-off
  always has an approver.
- How is "what is in transit for this transfer" known, when an in-transit location holds every
  transfer from its origin, mixed by lot?

## Decision

1. **Two stock documents.** A transfer is a stock document (`transfer`, TR-2026-00001) whose
   posting is its dispatch: draft → dispatched, or cancelled before it leaves. Its receipt is a
   stock document of its own (`transfer_receipt`, RT-2026-00001), raised at the destination against
   the transfer: draft → submitted → approved → posted, or rejected. Each posts once, in one
   transaction, like every other document.
2. **Dispatch confirms what left.** A draft lists items and quantities. Dispatching it records the
   lots that really left, one lot line each, numbered across the transfer. FEFO (#13) suggests them
   on the transfer's business date; the person may change them, never to a lot expired on that date
   (`expired_lot`). Every line leaves with at least one lot (`nothing_picked`): a line the origin
   cannot fill is taken off the draft. A variable-weight lot leaves with its piece count
   (`pieces_required`). The ledger moves the lots from the origin to the origin's in-transit
   location and refuses anything that would take the origin below zero. A lot's cost and expiry
   never change on the way (ADR-0004, ADR-0014).
3. **Exactly one receipt posts.** Several receipts of one transfer may be drafted, but posting one
   locks the transfer, marks it received and refuses any other with `already_received` (409). The
   transfer records the one receipt that took it out of transit, and the database refuses to record
   a second. A rejected receipt is final; the branch raises a new one.
4. **The receipt inspects each lot line with the goods receipt inspection, unchanged.** The
   expected quantity is what that lot line dispatched; what arrived is the counted quantity. The
   computed expiry is the lot's own, and there is no supplier date, so a transfer is never "short
   dated". Over and under quantity, too warm and damaged are findings exactly as at a goods receipt.
5. **Every dispatched quantity is accounted for.** Per lot line the receiver records what arrived,
   and splits what was dispatched into **accepted** (into the destination), **returned** (back to
   the origin) and **written off** (out of stock). Accepted + returned + written off = dispatched,
   exactly, pieces included, or the receipt is refused (`difference_unresolved`). Only what arrived
   can be accepted, and only what arrived and was not accepted can go back on the truck; what never
   arrived is written off. Weight may be written off without pieces (chicken loses weight on the
   road; birds do not vanish). A lot that has expired by the receipt's date is never accepted into
   the destination (`expired_on_arrival`); it goes back or is written off.
6. **Reasons and approval.** A line with a finding, a return or a write-off needs a reason. A
   receipt with a finding **or any write-off** needs the approval of someone other than its creator
   holding `transfer:approve_receipt`, given to the plant role: the origin that confirmed what left.
   A return alone needs no approval: nothing is lost. A receipt with neither posts when it is
   submitted.
7. **Posting the receipt** moves, in one transaction: accepted from in-transit to the destination,
   returned from in-transit to the origin, written off out of in-transit.
8. **In transit per transfer comes from the transfers.** An in-transit location's balance is per
   lot, from every transfer of its origin. Because one receipt clears everything a transfer
   dispatched, a transfer's share is exactly its dispatched lot lines until its receipt posts.
   `GET /transfers/in-transit?asOf=` answers that for any business date; stock on hand shows it next
   to the in-transit balances.
9. **No reversal in this release.** A dispatch made by mistake is undone by a receipt that returns
   everything to the origin; a receipt posted wrongly is corrected by a stock adjustment. Reversing
   either is left for an issue of its own.

## Consequences

- Each end of a transfer is a document with its own number, date, people and log lines, which is
  what an investigator follows (ADR-0011).
- A branch can never take stock twice for one delivery, whatever runs at the same time.
- A receiver records three numbers per lot line instead of one. The console fills in the obvious
  case (all accepted) and asks only for the difference.
- The ERP has no assignment of people to locations yet: anyone holding `transfer:receive` can
  receive at any destination, and anyone holding `transfer:dispatch` can dispatch from any origin.
  Restricting that is a separate issue.

## Alternatives considered

- **One document posted twice.** Breaks ADR-0003's one posting per document, and a reversal of
  "the transfer" would have to choose which half to undo.
- **Moving stock straight to the destination at dispatch.** Rejected by ADR-0007: the branch would
  show stock it has not received.
- **Leaving a difference in transit to be settled later.** Rejected by ADR-0007: stock that is
  "somewhere" is the problem transfers exist to prevent.
- **Approval for every difference, returns included.** A return loses nothing and the origin sees
  it come back; asking for an approval there adds a step without adding control.

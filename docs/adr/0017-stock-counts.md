# ADR-0017: Stock counts — blind, as of a count time, and allocated to lots by rule at branches

- **Status:** Accepted
- **Date:** 2026-09-26
- **ภาษาไทย:** [0017-stock-counts.th.md](0017-stock-counts.th.md)

## Context

A stock count is how the books meet the shelf. ADR-0003 lets branch stock go negative and asks for a count
when it does; ADR-0008 says a count's adjustment is approved by someone else. Three questions are still open,
and each has a wrong answer that looks reasonable:

- **When is "the book"?** Sales keep happening while a branch counts, and a POS that was offline delivers
  its sales hours later (ADR-0002). A count compared with "the balance right now" compares two different
  moments.
- **What does a branch count?** The plant labels its lots; a branch does not. The POS is lot-unaware and a
  cook opens whichever bag is nearest (ADR-0006). Asking branch staff to count per lot produces numbers that
  look precise and are not.
- **Which lot absorbs a branch difference?** The ledger is per lot (ADR-0003), so an item-level difference
  has to land on lots somehow, and the rule decides what cost the variance carries.

## Decision

1. **A count has a count time.** It is one document for one location. The **book quantity** of each line is
   the balance **as of the count time**, by business time (ADR-0018). Operations do not stop: postings keep
   arriving during and after the count, and none of them change what the count is compared with.
2. **Counts are blind.** The person counting enters quantities without seeing the book quantity. The book
   quantity and the difference are shown only after the count is submitted. A counter who can see the
   expected number tends to find it.
3. **Plants and warehouses count per lot; branches count per item.** A plant or warehouse line names a lot.
   A branch line names an item, in its base unit, with the secondary quantity for variable-weight items
   (ADR-0005). The count screen at a branch never asks for a lot.
4. **A branch difference is allocated to lots by a fixed rule**, as a pure domain function:
   - **Shortage** (counted below book): taken from the item's lots at the branch that have a positive balance,
     earliest expiry first, expired lots included, because a count records what is gone, not what may be
     issued. If the shortage is larger than the positive balances, the remainder goes to the branch's **most
     recently received lot** of that item, the same rule branch consumption uses when stock runs out (#17).
   - **Surplus** (counted above book): first brings the item's **negative** lots back to zero, earliest expiry
     first; any remainder goes to the most recently received lot of that item at the branch.
   - **A surplus with no lot to go to** (the branch has never received the item) is refused for that line,
     with the reason stated. Lots are created only by receipts and production (ADR-0006), so stock found at a
     branch that the ERP never sent there points to a missing transfer, and a count is not allowed to invent
     it.
   - Every allocated entry carries its lot's cost (ADR-0004), so the variance has a value.

   Worked example — branch B-01, drumstick, count time 22:00, book 40 pieces across three lots:

   | Lot | Expiry | Book at 22:00 |
   |---|---|---|
   | L1 | 1 Oct | 5 |
   | L2 | 2 Oct | 20 |
   | L3 | 3 Oct (latest received) | 15 |

   Counted 28 (shortage 12): L1 −5, L2 −7. Counted 45 (surplus 5): no negative lots, so L3 +5.
   If L1 had been −3, L2 43 and L3 0 (book still 40), a count of 45 gives L1 +3, then L3 +2.
5. **A plant or warehouse line whose lot is not in the books is refused.** The count cannot create a lot there
   either.
6. **The count posts as an adjustment, approved by someone else.** Posting reuses the adjustment document and
   the approval rule of ADR-0008 (nobody approves a count they created). Book quantities are recomputed at
   approval as of the same count time, so a posting that arrived in between with an earlier business time is
   reflected, and the approver sees the difference change if it did.
7. **Late POS sales are shown to the approver, not waited for.** For a branch, the approval screen shows the
   latest sale time the ERP has received from each POS instance serving it. If any is earlier than the count
   time, it warns that sales from before the count may still be on their way. The approver may still post;
   the acknowledgement is recorded. A sale that arrives later posts as consumption like any other (ADR-0003),
   and the difference it makes is found by the next count.

## Consequences

- A count is comparable with the books even though the branch never closes.
- The cost of a branch variance is decided by a rule anyone can check by hand, not by whichever lot a
  function happened to pick.
- Counts at branches remain item-level. The same limit as ADR-0006 applies: if branches ever select lots
  when opening packs, per-lot branch counts become possible and this rule is revisited.
- A count posted before an offline POS catches up leaves a difference that the next count finds. The
  warning makes this visible; blocking the count until every POS reports in would let one offline tablet
  stop a branch from ever closing its books.

## Alternatives considered

- **Compare with the balance at the moment of submission.** Rejected: sales during the count make every
  count wrong by the amount sold while counting.
- **Freeze the location during a count.** Rejected: a restaurant cannot stop selling to count.
- **Count per lot at branches.** Rejected for v1: branch staff cannot tell lots apart, so the numbers would
  be invented.
- **Put the whole branch difference on one lot.** Rejected: it gives variances an arbitrary cost and can drive
  a single lot far negative while others keep stale balances.
- **Refuse a branch count until every POS instance has delivered sales past the count time.** Rejected: see
  Consequences.

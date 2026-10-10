# ADR-0030: Branch consumption: one document per sale, placeholder lots, held sales and the automatic account

- **Status:** Proposed
- **Date:** 2026-10-10
- **ภาษาไทย:** [0030-branch-consumption-placeholder-lots-and-held-sales.th.md](0030-branch-consumption-placeholder-lots-and-held-sales.th.md)

## Context

ADR-0002 decides that the ERP turns the sales events a POS delivers into branch consumption,
exploded with the recipes in force at the time of sale; ADR-0003 that a branch may go negative and a
sale is never refused because of stock; ADR-0004 that consumption carries the cost of the lot it
takes; ADR-0006 that lots are consumed FEFO. Building it (#17) leaves questions those decisions do
not answer:

- When a branch's usable lots cannot cover a sale, which lot goes below zero, and what if the branch
  never held the item at all, so there is no lot to send negative?
- A POS tablet with a wrong clock can date a sale a day or a year ahead. Posting it there would put
  consumption into a period nobody is looking at.
- Every ledger entry names who posted it, but the processor runs with nobody signed in.
- A sale whose menu item, modifier or ingredient is wrong cannot become consumption until someone
  fixes the master data. What may be tried again, and who posts it then?
- Two processors (two API replicas, or a run on a timer and one a person started) must not consume
  one sale twice.

The product owner decided each of these on #17; this records them.

## Decision

1. **One branch-consumption document per sales event.** Its number comes from the `BC` sequence; it
   records the event, the branch, the menu item, the recipe version in force on the sale date, and one
   line per ingredient with the exact theoretical usage and the quantity posted, rounded once
   (ADR-0019). `sales_event_id` is unique, so whatever runs concurrently there is one document per
   event; the ledger refuses to post a document twice; and the processor claims an event with
   `FOR UPDATE SKIP LOCKED` before it writes anything.
2. **Every entry's business time is the sale's own time**, for this document type only; its business
   date is the sale's date in the company's time zone (ADR-0018). Posting time is when it was
   processed, so a POS that was offline for a day shows day-late consumption, as ADR-0002 accepts.
3. **Allocation at the branch** takes FEFO from the branch's usable lots. Whatever they cannot cover
   is taken from the lot of that item the branch received most recently, even if it is used up or
   past its expiry: that lot goes below zero, and the stock screen asks for a count (#8). When that
   lot had expired on the sale date, the document and the usage report say **consumed expired lot**:
   a food-safety signal, never hidden.
4. **A placeholder lot** stands in when the branch has never held the item: one per branch and item,
   numbered `PH-<branch>-<item>`, created the first time it is needed. It holds nothing, so it only
   ever goes below zero; it has no expiry; FEFO never takes it, and no other document type can touch
   it. Its cost is the cost of the item's most recently received lot anywhere in the chain, labelled
   **estimated cost**; when the chain never held the item its cost is 0, labelled **no cost known**.
   The cost is fixed when the placeholder is created, like any lot's. A recall (#23) must never report
   a placeholder as the lot something came from: it is not a lot anyone received.
5. **A sale dated too far ahead is held, not failed.** When its sale time is later than the time the
   ERP received it by more than the company's tolerance (configuration, 10 minutes by default,
   ADR-0007), it stays received, flagged `sale_time_ahead`, shown on the screen and logged once. Its
   time is never corrected. A person may re-process it once its date has come. A sale dated after
   today but within the tolerance (a sale just before midnight on a clock a little fast) simply waits
   for its day.
6. **A sale that cannot become consumption fails with its reason**: `unknown_menu_item`,
   `unknown_modifier`, `no_recipe_in_effect`, `sold_by_mismatch`, `inactive_ingredient` or
   `negative_usage`. A menu item or modifier no longer on sale still consumes its recipe: the sale
   happened.
7. **Re-processing.** A person with `sales_event:reprocess` (the admin) asks for a failed or held
   event to be tried again, and the attempt is theirs: they post the consumption that follows, and
   the result is the same as if it had succeeded the first time. It is offered only where it can
   help: for an unknown menu item or modifier and an inactive ingredient always; for a held sale once
   its date has come; for no recipe in effect only on the sale's own day, because a recipe never
   starts in the past, so an older sale stays failed (#76); never for how a line was sold or for
   recipes that disagree. Every attempt and every request is kept, in order, and never changed.
8. **The automatic account**, "PaynEat ERP — automatic", posts what the processor does on its own. It
   has no usable password and no second factor, holds no role, never signs in and never approves
   anything; the database refuses each of these. It is left out of the user list but named on every
   document and audit entry it posts. It posts branch consumption and nothing else.
9. **The processor** runs on an interval (configuration; 0 turns it off), through a job lock adapted
   from Cwork, so one replica runs it at a time; a person may start a run at once. Neither depends on
   the lock for correctness: decision 1 does that.
10. **Closed periods are not checked yet.** When #25 adds period close, a sale in a closed period has
    one place to be checked: the processor, before it creates the document. Until then a late sale
    posts into its own date, whatever that date is.

## Consequences

- Stock and cost stay visible when a branch sells what it does not have: the negative balance is on a
  real lot or a placeholder, never silently absorbed, and every estimate says it is one.
- A wrong POS clock cannot push consumption into a distant period; it waits for a person.
- Fixing master data and re-processing gives the same documents as a sale that never failed.
- Adjusting a placeholder lot with a stock adjustment is not possible yet: an adjustment document only
  takes lots FEFO can see. Counting a branch that sold what it never received means stocking the item
  first; a follow-up issue decides how a count settles a placeholder.

## Alternatives considered

- **Refuse or fail a sale the branch cannot cover.** Rejected by ADR-0003: the sale happened.
- **Spread the shortfall over the branch's expired lots, or the plant's.** Rejected: it would claim a
  lot was used that the branch may never have had, and plant stock never goes negative.
- **Correct a sale's time to its receipt.** Rejected: the ERP would invent a fact. Holding it shows
  the problem to a person instead.
- **Post as the person who registered the POS.** Rejected: an entry would name someone who did
  nothing, and that person could be disabled or leave.

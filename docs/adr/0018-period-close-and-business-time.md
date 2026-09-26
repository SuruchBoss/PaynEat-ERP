# ADR-0018: Period close by business date, and sales that arrive after their period closed

- **Status:** Accepted
- **Date:** 2026-09-26
- **ภาษาไทย:** [0018-period-close-and-business-time.th.md](0018-period-close-and-business-time.th.md)

## Context

ADR-0003 decision 7 closes periods per location with a closed-until date and makes reopening an audited
admin action. It leaves open which date a posting is judged by. It also sets up a conflict with two other
rules:

- A POS can deliver sales a day late (ADR-0002), and **a sale is never refused because of stock**
  (ADR-0003). A late sale whose day has been closed cannot be refused either. Refusing it would drop real
  consumption from the books.
- Branch consumption already separates the time a sale happened from the time it was posted (#17). Counts
  (ADR-0017) and stock on hand "as of a date" need the same separation everywhere, or "as of" means
  different things in different reports.

Finance also needs to know that figures it has taken into the accounting software have not changed under
it, and to be told plainly when they have.

## Decision

1. **Every ledger entry has a business time and a posting time.** Business time is when the movement
   happened: the receipt, production or dispatch date of the document, or the sale time of a sales event.
   Posting time is when the ERP wrote the entry. A document's business date defaults to today and can be
   earlier, never later. Stock on hand as of a date, counts and period figures all use **business time**.
2. **Period close is a closed-until date per location, in the company's time zone.** The time zone is
   configuration (default `Asia/Bangkok`). A posting that would write any entry at a location with a
   business date on or before that location's closed-until date is refused with rule `period_closed`. A
   document that touches several locations (a transfer, a return) is checked at each of them. An in-transit
   location shares the closed-until date of the location it belongs to.
3. **Closing moves forward only**, to a date no later than yesterday. Before it closes, the console lists the
   drafts and submitted documents at that location dated inside the period. They do not block the close; once
   it is closed, they can post only with a later date.
4. **Who closes and who reopens.** `admin` and `finance` may close. **Only `admin` may reopen**, by moving the
   date backward with a required reason. Reopening is audited with who, when, the old and new dates and the
   reason (ADR-0003, ADR-0008).
5. **Sales from a closed period still post.** When a sales event's sale time falls on or before the branch's
   closed-until date, its consumption is posted with business time at the **start of the first open day** of
   that branch, marked **late for a closed period**, and it keeps the original sale time. The closed period's
   figures do not change; the next period shows the consumption and says where it came from. No other
   document type gets this exception.
6. **Period exports have revisions.** An export covers a date range at one or more locations and can be
   produced only when the whole range is closed at every location it covers. Reopening any part of an
   exported range marks those exports **superseded**. The next export of that range is a new revision that
   names the revision it replaces, so the accounting side can tell a correction from a duplicate.

## Consequences

- "Stock on 30 September" means the same thing in the stock-on-hand screen, a count and a period export.
- A closed period stays closed even while offline POS instances catch up; the late sales are visible as
  such in the period that received them.
- Backdating inside an open period is possible and shown: every entry keeps both times.
- The ledger (#7) and branch consumption (#17) carry business time from the start; tickets built earlier
  that record only posting time are extended by the period-close ticket, not left inconsistent.
- The same idea of a revision is used by Cwork's labour-data feed. An accounting import can use one rule to
  handle a replaced export in both.

## Alternatives considered

- **Judge closing by posting time.** Rejected: a document entered on 2 October for a delivery on
  30 September would land in October, and "as of" reports would not match the shelf.
- **Refuse late sales in a closed period.** Rejected: it breaks ADR-0003 and silently loses consumption.
- **Reopen the period automatically when a late sale arrives.** Rejected: exported figures would change
  without anyone deciding it.
- **Monthly periods only.** Rejected: a closed-until date is simpler, lets a chain close weekly or daily, and
  an export chooses its own range.

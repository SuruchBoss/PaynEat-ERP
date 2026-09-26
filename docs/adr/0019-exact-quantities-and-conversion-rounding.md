# ADR-0019: Exact decimal quantities, and one rounding rule for unit conversion

- **Status:** Proposed
- **Date:** 2026-09-26
- **ภาษาไทย:** [0019-exact-quantities-and-conversion-rounding.th.md](0019-exact-quantities-and-conversion-rounding.th.md)

## Context

ADR-0005 gives every item one base unit and converts purchase units to it by a fixed factor
(case → kg). #5 builds that conversion, and it will be used by every receipt, transfer and count
after it. Two things can quietly corrupt a ledger that must balance to the gram:

- **Binary floating point.** JavaScript numbers cannot hold 0.1 exactly: `0.1 * 3` is
  `0.30000000000000004`. A quantity that passes through one on its way to the database arrives
  slightly wrong, and sums of such values drift.
- **Rounding decided case by case.** 1 pack of 12.5 g in kg is 0.0125 kg; kept to grams it becomes
  0.012 or 0.013 depending on who wrote that screen. If the API, a report and the database each
  round differently, the same movement has three values.

A factor of zero or less is a third risk: a case "holding" 0 kg turns a delivery into nothing, and a
negative factor turns it into a withdrawal.

## Decision

1. **Quantities and factors are exact decimals everywhere.** Over the API they are decimal strings
   (`"22.5"`, never a JSON number); in PostgreSQL they are `NUMERIC`; in the domain they are
   integers of the smallest step held in a `bigint` (`backend/src/core/quantity/domain/exact-decimal.ts`).
   No quantity or factor passes through a binary floating-point number.
2. **Every unit keeps its quantities to a fixed number of decimals**, carried by the unit itself:
   3 for kg and litres (grams, millilitres), 0 for pieces, cases, bags and the other counted units.
   The unit catalogue ships with the release (a migration), the same on every installation.
3. **A conversion factor is greater than zero**, has at most 6 decimals and at most 12 digits before
   the point (it is stored as `NUMERIC(18,6)`). The API refuses anything else, naming the row and
   the reason, and the database refuses a non-positive factor as a backstop.
4. **Converting a purchase quantity to the base unit** multiplies exactly and **rounds once, half
   away from zero, to the base unit's decimals** — the rule of PostgreSQL's `round(numeric, n)`, so
   the API and a SQL report never disagree. 3 cases × 20 kg = `30.000` kg; 1 pack × 0.0125 kg =
   `0.013` kg; its return is `-0.013` kg. The exact product is rounded, never the factor first.
5. **A quantity entered in a unit may not be more precise than that unit allows**: 2.5 cases is
   refused, not rounded to 2 or 3.
6. **An item's base unit never changes once the item exists**, and nor does its code. Every quantity
   recorded for it is in that unit; changing the unit would silently re-scale all of them. A wrong
   base unit is fixed by creating a new item and deactivating the old one.

## Consequences

- Conversion is one pure function with unit tests
  (`backend/src/modules/items/domain/unit-conversion.ts`); receiving, transfers and counts reuse it.
- Clients (the console, the POS, ExcelToGo) send and receive quantities as strings and never do
  arithmetic on them in floating point; the console shows the API's strings as they are.
- Rounding happens once, at conversion. A document keeps the quantity as entered, in its unit,
  beside the converted base quantity, so the rounding is always visible and explainable.
- A unit that is not in the catalogue needs a release. Accepted for v1: the catalogue covers the
  chain's path, and a unit changes rarely.

## Alternatives considered

- **JavaScript numbers with rounding at the edges.** Rejected: the error is already in the value
  before any edge sees it, and every new screen is a new chance to forget the rounding.
- **Banker's rounding (half to even).** Rejected: it removes a statistical bias that does not matter
  at the scale of one delivery, and it disagrees with PostgreSQL's `round()` and with what a person
  checking by hand or in a spreadsheet expects.
- **Rounding per item** (each item choosing its own precision). Rejected for v1: the unit already says
  how finely it is counted; a per-item override can be added without migrating history.
- **Keeping only the base quantity.** Rejected: the purchase quantity is what the supplier invoiced;
  losing it hides the rounding and makes three-way matching harder later.

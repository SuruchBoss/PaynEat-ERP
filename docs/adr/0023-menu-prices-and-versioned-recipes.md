# ADR-0023: Menu prices and recipes start on a business date, and never change once in force

- **Status:** Accepted
- **Date:** 2026-10-02
- **ภาษาไทย:** [0023-menu-prices-and-versioned-recipes.th.md](0023-menu-prices-and-versioned-recipes.th.md)

## Context

ADR-0002 makes the ERP the system of record for what branches sell: menu items, prices, menu recipes and
modifier recipes, which a connected POS mirrors read-only. Theoretical usage explodes each sale with the recipe
**in effect at the time of sale**. ADR-0005 adds that a weighed sale arrives with its weight, and that menu
recipes can be per kilogram sold. ADR-0018 counts everything by business date, in the company's time zone.

Issue #16 builds this, together with contract 1.1. It asks for versioned recipes that never overlap and are
never edited after they take effect. It asks for prices with an effective-from date and a per-branch override,
and for a recipe editor that shows a theoretical cost per portion from current lot costs. Several rules behind
these requirements were not yet written down:

- what "in effect" means;
- how soon a new version may start;
- whether a mistake in a version or a price can be corrected;
- how a branch price and a chain price combine;
- which lot cost a recipe is priced at.

Each of these changes the numbers a stock report or a POS shows.

## Decision

1. **Prices and recipe versions start on a business date** (`YYYY-MM-DD`, company time zone, ADR-0018). A
   version is in force from its effective-from date until the next version of the same recipe starts. There
   is no end date to keep in step. Two versions of one recipe never start on the same day; that is the only
   way two could overlap, and it is refused (`RECIPE_VERSION_OVERLAP`). "The recipe in effect on date D" is a
   pure domain function (`recipeInEffect`), and #17 uses it with the sale's business date.
2. **A recipe never changes for a day that has begun.**
   - A first version may start today.
   - Once a version is in force, a new one starts tomorrow at the earliest (`RECIPE_TOO_EARLY`), because sales
     may already have been made today with the version in force.
   - A version may start between two others, as long as both are still to come.
3. **Corrections only before the day comes.**
   - A version that has not taken effect can have its lines replaced.
   - A version in force or past never changes (`RECIPE_VERSION_IN_EFFECT`); a new version replaces it from a
     later day.
   - Prices follow the same rule. Setting a price again for the same menu item, branch (or none) and day
     corrects it until that day; from then on it is refused (`PRICE_IN_EFFECT`).
   - A price never starts in the past (`EFFECTIVE_FROM_IN_PAST`): the POS has already sold at the price of a
     day that has passed.
   - Nothing on the menu is ever deleted: menu items, groups and options are deactivated, and the database
     refuses deletes.
4. **A branch's own price wins at that branch for as long as it is in force, and it can end.**
   - On a given day a branch charges its own price in force that day if it has one, else the chain-wide
     price in force that day.
   - A later chain-wide change does not override a branch price that is still in force.
   - A branch's own price ends with a branch price row that has no price (`price: null`): from its day the
     branch charges the chain-wide price in force again, including chain-wide changes that start later,
     until the branch gets a price of its own again. Without it, a branch that once had its own price could
     only follow the chain by having a matching price re-entered after every chain-wide change.
   - Such a return is a price row like any other: it starts today or later, can be corrected only before its
     day, and is never deleted. The chain-wide price always has a price (`CHAIN_PRICE_REQUIRED`); the
     database and the contract schema both refuse a chain-wide row without one.
   - Prices are the selling price as the POS shows it; tax stays in the POS.
5. **A modifier recipe is per one unit sold of the line it is on**, and may remove an item (a quantity below
   zero, "no sauce"). Theoretical usage of a sale line is:
   - the menu recipe × the line's quantity (or `weightKg`), plus
   - for each modifier, the option recipe × the modifier's quantity × the line's quantity (or `weightKg`).

   This is a pure domain function (`theoreticalUsage`), as contract 1.0 already agreed with the POS for the
   modifier quantity. A menu recipe of an item sold by weight is per kilogram sold. How an item is sold is fixed
   once the menu item exists.
6. **The theoretical cost of a recipe is an estimate, shown as one.**
   - Each line is priced at the item's **current lot cost**: the unit cost of the lot FEFO would take next,
     that is the unexpired lot with stock left anywhere that expires first, oldest first on a tie.
   - An item with no such lot has no cost. It is never priced at zero: the total is then labelled a floor
     ("at least"), or "no cost yet" when no line has one.
   - Consumption still takes the cost of the lot FEFO picks at its own location and time (ADR-0004). Nothing
     posts at this cost.
7. **Reading the menu needs `menu:read`** (admin, finance, branch managers); only `menu:manage` (admin)
   changes it.
   - Recipes and their costs are commercial information, unlike items and locations, which anyone signed in
     reads.
   - Finance views costs (ADR-0008), and a branch manager runs a branch that sells the menu.

## Consequences

- #17 explodes a sale with `recipeInEffect` on the sale's business date and `theoreticalUsage`. It never needs
  to ask whether a version was edited after the sale, because none can be.
- Contract 1.1 can tell the POS that a price or recipe that has started never changes. A correction to a
  scheduled one arrives as the same `id` with `action: updated`.
- A typo in a recipe that is already in force stays in force until tomorrow's version starts. This is
  accepted. The alternative would change usage that has already been reported.
- The demo seed writes yesterday's prices and recipes directly, because a script may write history. The API
  never backdates.
- A POS stores a return like any other price row and applies the same rule (contract 1.1 prose, "Prices").
  Because it is in 1.1 from the start, no POS keeps charging an ended branch price without knowing it.

## Alternatives considered

- **Versions with an explicit end date.** Rejected: an end date has to be kept in step with the next start.
  A gap or an overlap between the two would be a new way to be wrong.
- **Allowing a new version to start today.** Rejected: sales already exploded today would no longer match the
  recipe the same day reports with.
- **Weighted average cost of all lots on hand for the theoretical cost.** Rejected for v1: it is a cost the
  ledger never posts. The next FEFO lot is the cost the next sale will most likely carry, and it can be
  checked by hand against stock on hand.
- **A branch price that can never end.** Rejected (product owner, 2026-10-05): a branch that once set its
  own price would never follow a chain-wide change again, and adding a way to end it in a later contract
  version would leave a 1.1 POS charging the old branch price without saying so.
- **Ending a branch price by deleting its rows.** Rejected: nothing on the menu is deleted (decision 3), and
  the POS must still know what the branch charged before.
- **Opening the menu to everyone signed in, like items.** Rejected: recipes and costs are what a competitor
  would most like to see. The plant and purchasing roles have no need for them.

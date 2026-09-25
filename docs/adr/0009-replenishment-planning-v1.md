# ADR-0009: Replenishment planning in v1 — reorder points, requisitions, MRP-lite

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0009-replenishment-planning-v1.th.md](0009-replenishment-planning-v1.th.md)

## Context

A chain wins or loses margin on buying the right quantity at the right time and producing only what
branches will sell. Forecasting demand and timing purchases around price need sales history the
system does not have on day one; a forecast built without it would be invented numbers, which
contradicts the goal in ADR-0001.

## Decision

1. **Reorder points** at the plant and warehouses flag items that should be bought from suppliers.
2. **Branches raise requisitions.** Each item has a par level per branch; the requisition screen
   suggests par minus current balance minus stock already in transit, and the branch manager edits
   and submits. The plant does not push stock to branches automatically in v1.
3. **MRP-lite consolidates open requisitions** into suggested production orders (using production
   BOMs and expected yield) and suggested purchase orders (for inputs short after reorder points).
   **Suggestions only:** a person reviews and creates the actual documents.
4. **Forecasting and purchase timing are future work** for an AI agent that analyses sales and
   purchase history and raises alerts. It will read the same ledger and documents; nothing in v1 is
   shaped around it except keeping that history complete.

## Consequences

- The plant can answer "what do we produce and buy tomorrow" from real branch requests, not guesses.
- Planning quality depends on par levels being maintained. The ERP shows how often par was missed,
  so bad par levels are visible.

## Alternatives considered

- **Automatic replenishment pushed from the plant.** Deferred: it needs trusted par levels and
  consumption data first.
- **Statistical forecasting in v1.** Rejected: no history yet, and invented forecasts would
  undermine trust in every other number.

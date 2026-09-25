# ADR-0004: Actual lot cost, FEFO consumption, and cost allocation across co-products

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0004-lot-costing-and-cost-allocation.th.md](0004-lot-costing-and-cost-allocation.th.md)

## Context

A 1.8 kg whole chicken becomes drumsticks, thighs, wings, breast, a frame for stock, and some
waste. Its purchase cost has to end up on those outputs, and the outputs are worth very different
amounts per kilogram. The costing method also has to agree with how stock is picked, or reported
cost and physical reality drift apart.

## Decision

1. **Every lot carries its actual unit cost.** A goods receipt sets it from the purchase order price
   net of recoverable VAT. A production output lot gets its cost from the allocation below.
2. **Consumption takes the cost of the lot it takes.** Issues, production inputs, transfers and
   branch consumption pick lots **FEFO** (first expired, first out), and each ledger entry carries
   the picked lot's cost. Cost and physical flow follow the same rule.
3. **Production cost is allocated by ratios on the production BOM.** Each output of a BOM has an
   allocation ratio; the total cost of the consumed input lots is split across the outputs by those
   ratios, then divided by each output's actual quantity to give the output lot's unit cost.
   **The default ratio is share of expected output weight**, and the plant can override it (for
   example to give breast a higher share than frames). Waste carries no cost; its cost is absorbed
   by the outputs, which is what makes poor yield visible as higher unit cost.
4. **Transfers carry cost unchanged.** Moving a lot from the plant to a branch does not change its
   unit cost in v1.
5. **Until three-way matching exists, receipt cost is the purchase order price.** If the supplier
   invoice later differs, v1 does not revalue lots already consumed; this limitation is recorded
   here and in the three-way matching issue.

## Consequences

- Cost is explainable line by line: any branch consumption can be followed to a lot, to a
  production order, to the supplier receipt and its price.
- Yield problems surface as cost: a production order that yields 60 % instead of 70 % produces
  visibly more expensive pieces.
- Labour and overhead are not absorbed into production cost in v1; product cost is material cost.
  Labour cost is expected to arrive later from Cwork (ADR-0001).

## Alternatives considered

- **Moving weighted average cost.** Simpler, but it discards the per-lot information the ledger
  already holds, and it disagrees with FEFO picking about which stock was used.
- **Standard cost with variances.** Common in large manufacturers and a good later addition, but it
  needs a costing cycle and variance reporting that would dominate the first release.
- **Allocation by weight only.** Rejected as the only option: it prices breast and frames the same
  per kilogram, which no plant accepts. It remains the default.

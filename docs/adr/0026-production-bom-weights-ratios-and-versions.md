# ADR-0026: Production BOMs: weights, default allocation ratios, waste, and versions

- **Status:** Accepted
- **Date:** 2026-10-10
- **ภาษาไทย:** [0026-production-bom-weights-ratios-and-versions.th.md](0026-production-bom-weights-ratios-and-versions.th.md)

## Context

ADR-0004 decides that a production order splits the cost of its inputs across its outputs by
allocation ratio, and that the ratios come from the BOM, defaulting to each output's share of
expected output weight. Building production BOMs (#12) leaves questions that decision does not
answer:

- Outputs are counted in different units: pieces of chicken by the piece, frames by the kilogram.
  What is a "weight" for an output counted in pieces?
- How are the default ratios rounded, so that they add up to exactly 100 %?
- What may an admin enter when overriding them?
- What happens to waste, the weight that goes in and comes out as no output?
- How does a BOM change without changing what a production order already used?
- Is a BOM master data that every POS mirrors?

## Decision

1. **Every quantity is compared by weight in kilograms.** A line counted in kg weighs its quantity,
   a line counted in g a thousandth of it. A line counted in any other unit (pieces, litres, packs)
   states the weight it is expected to have per batch, inputs and outputs alike; a kg or g line
   states none. Weights are kept to the gram.
2. **The default allocation ratio of an output is its share of expected output weight, in percent
   to 0.01 %.** Each share is cut down to 0.01 %; the hundredths still missing go one each to the
   outputs that lost the most in the cut, and on a tie to the earlier line (largest remainder). The
   ratios therefore always add up to exactly 100.00.
3. **An admin may override the ratios: all of them or none.** Each overriding ratio is above zero,
   at most 100, with at most two decimals, and together they add up to exactly 100.00. A version
   stores the ratios it allocates by and whether they were overridden; default ratios are worked out
   again whenever the quantities of a version are corrected.
4. **Waste is input weight less expected output weight, and carries no ratio.** Its cost stays with
   the outputs. A version whose outputs are expected to weigh more than its inputs is refused: a
   batch cannot gain weight.
5. **An item appears at most once on each side, and never on both.** A batch does not consume what
   it makes.
6. **BOMs are versioned by effective date with the rules ADR-0023 gives recipes.** A version is in
   force from its effective-from business date until the next version starts. A new version starts
   today when none is in force, else tomorrow at the earliest, and never on the day another version
   starts. A version in force never changes; one not yet started may be corrected. Production
   orders (#13) record the version they used.
7. **A BOM is configuration, not master data.** Changes are audited but take no master data
   version: a POS never receives a BOM, and the POS contract does not change. Only `admin` changes
   BOMs; `plant` and `finance` read them (ADR-0008).
8. **The plant runs BOMs in v1.** A BOM names the type of location that runs it, and the only type
   accepted is `plant`.

## Consequences

- The whole-chicken example of #12 is checkable by hand: 20 kg in, 18 kg of pieces and frames
  expected, 2 kg waste, 90 % yield, default ratios 27.78 / 20.00 / 15.56 / 12.22 / 24.44.
- The ratios a production order splits cost by are fixed on the version it used, so a later change
  of BOM never re-costs a finished batch.
- An output counted in pieces needs its expected weight kept up to date by hand; the plant will see
  the actual weights on production orders (#13) and can correct the BOM with a new version.
- The console cannot import backend code (ADR-0021), so it asks the API to preview a version while
  it is typed (`POST /production-boms/preview`), as goods receipts do. The rules exist once.

## Alternatives considered

- **Ratios by count of outputs, or by sales value.** Rejected for the default: ADR-0004 chose
  weight share, and sales value needs prices the plant does not have. An override covers a chain
  that wants breast to carry more than frames.
- **Round each ratio half-up independently.** Rejected: the ratios would add up to 99.99 or 100.01,
  and a batch's cost would not be fully allocated.
- **Give waste its own ratio.** Rejected: waste is not stock and no lot receives it; its cost has
  to land on the outputs.
- **Let outputs in pieces carry no weight and leave them out of the default.** Rejected: the most
  valuable outputs (breast, thigh) are counted in pieces and would carry nothing.

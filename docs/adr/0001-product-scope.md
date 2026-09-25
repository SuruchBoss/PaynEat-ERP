# ADR-0001: Product scope — an ERP for a vertically integrated restaurant chain

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0001-product-scope.th.md](0001-product-scope.th.md)

## Context

PaynEat started as a point-of-sale system for a single restaurant. A mass-market restaurant chain
runs a much larger machine behind its tills: it buys raw materials from many suppliers at the right
moment, processes them in its own plant (whole birds into portioned pieces, for example), ships
the output to its branches, and only then sells it to guests. Most open-source ERPs are generic and
leave that food-specific middle — lots, expiry, yield, cold chain, traceability — as an exercise
for the implementer.

The measure of success for this project is that **someone who has run ERP in food service or food
processing can read this repository and recognise that the domain is modelled correctly.** Being
usable as a portfolio piece follows from that; downloads and stars are not goals.

## Decision

PaynEat ERP covers the supply side of one restaurant chain that controls its own chain end to end:

1. **Procurement** — suppliers, purchase orders, goods receipts with inspection, returns to supplier.
2. **Production** — the company's **own** plant turns input lots into output lots with measured
   yield and cost allocation. Subcontracted processing is designed for (a location type is
   reserved) but not built.
3. **Distribution** — branch requisitions, transfers through an in-transit location, inspected
   receipts at both ends.
4. **Branch consumption** — sales from PaynEat POS become theoretical usage through versioned
   recipes.
5. **Control** — an append-only stock ledger, stock counts, period close, lot traceability and
   recall, segregation of duties.
6. **Planning** — reorder points, par-based requisition suggestions, and MRP-lite suggestions.

The reference scenario used everywhere (demo data, tests, docs) is a fictional fried-chicken chain:
one plant, three branches, two suppliers.

### Explicitly out of scope

| Area | Where it lives instead |
|---|---|
| General ledger, accounts payable payments, financial statements | Exported to the company's accounting software |
| People, attendance, leave, payroll | [Cwork](https://github.com/SuruchBoss/Cwork), the companion open-source HRIS. Integration is future work (see Consequences). |
| Guest-facing ordering, payments, tax invoices | [PaynEat POS](https://github.com/SuruchBoss/PaynEat) |
| Multiple companies in one installation | Not supported; one installation serves one company. |
| The supplier's own ERP | Not ours to build. |

## Consequences

- The first release is judged by one end-to-end path working exactly: buy chickens → receive with
  lots → cut into pieces with yield → transfer to a branch → sell on the POS → trace a sold dish
  back to its candidate supplier lots. Breadth is deliberately traded for that depth.
- Deferred, recorded here so they are decisions and not omissions: three-way invoice matching
  (stretch goal for v1), standard costing, full catch-weight, subcontracted processing, per-pack lot
  scanning at branches, demand forecasting and purchase timing (future AI agent), a tablet app for
  receiving and counting, moving PaynEat POS itself to PostgreSQL.
- **Cwork integration (future).** Cwork already models `WorkLocation`, departments with a
  `costCenter`, attendance per work location, payroll runs and a transactional outbox. The expected
  shape: ERP locations map one-to-one to Cwork work locations by a stable code; payroll cost per cost
  centre per period flows into the ERP as labour cost for branch and plant cost reporting; attendance
  hours per work location enable labour productivity measures (for example sales per labour hour).
  To keep that cheap, **every ERP location carries a stable, human-readable code from day one.**
- Because GL is out of scope, every financial figure the ERP computes (stock value, cost of goods
  consumed, variances) must be exportable per period.

## Alternatives considered

- **A generic ERP with modules for every department.** Rejected: many half-finished modules prove
  less than one path that works exactly, and the food-specific problems are where credibility is won.
- **An ERP for the processing plant as a business of its own (selling to many customers).**
  Rejected: a different product with different customers.
- **Building HR and payroll inside the ERP.** Rejected: Cwork already does this properly for Thai
  labour practice; duplicating it would be weaker than integrating with it.

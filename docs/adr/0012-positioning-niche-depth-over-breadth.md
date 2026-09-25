# ADR-0012: Positioning — the best open-source option for one niche, not a general ERP

- **Status:** Accepted; decision 4's "no paid edition" superseded by [ADR-0015](0015-editions-community-and-enterprise.md)
- **Date:** 2026-09-25
- **ภาษาไทย:** [0012-positioning-niche-depth-over-breadth.th.md](0012-positioning-niche-depth-over-breadth.th.md)

## Context

The obvious benchmark for an open-source ERP is Odoo. Its breadth — accounting, HR, CRM,
manufacturing, e-commerce and much more, localised for many countries, extended by a large community
and a partner network — is the product of roughly two decades, a company with a large development team,
and an ecosystem of other people's modules. It is not the product of code alone.

This project is built by one maintainer with AI coding agents. Chasing that breadth would produce many
half-finished modules, which is exactly what ADR-0001 rejects because it destroys credibility with the
people this project is meant to convince.

Depth in a narrow field is a different contest. A general ERP treats food as one industry among many;
food-specific needs such as variable-weight items, yield and co-product costing, and honest lot
traceability typically need add-ons or customisation there. Thai specifics — PromptPay, Thai tax
invoices, selling by weight on a scale, Thai labour and payroll rules — are further still from a
general ERP's core. (These observations about general ERPs should be re-checked against their current
releases before being quoted anywhere public.)

## Decision

1. **The goal is to be the best open-source option for Thai restaurant chains that run their own
   supply chain**, not to be a general ERP and not to match Odoo's breadth.
2. **Three levels, with the target named:**

   | Level | What it means | Target? |
   |---|---|---|
   | 1. Credible reference | The first release's end-to-end path works exactly and people who know the field recognise it | Yes: first release |
   | 2. In production at several chains | Stable releases, upgrades that never break data, installation and operating guides, fixes driven by real users | **Yes: the goal** |
   | 3. A platform like Odoo | A module system for others to extend, a contributor community, partners who implement for customers | No: needs other people; revisited only if a community forms |

3. **Integrate instead of compete.** General ledger stays out of scope (ADR-0001). The ERP's period
   exports are designed so the figures can be imported into the accounting software a chain already
   uses — which may be Odoo itself or a Thai accounting product. That positions this ERP as a part a
   chain can add, not a system it must switch to wholesale. Which targets are supported first is decided
   with real users, not guessed.
4. **The differentiators to protect** are the ones breadth-first products do not prioritise: food-domain
   depth (ADR-0003 to ADR-0007), everything open under Apache 2.0 with no paid edition, Thai-first
   operation across the ecosystem (ADR-0011), and AI that answers only from evidence and says when data
   is missing (ADR-0011).

## Consequences

- Scope requests are judged by one question: does this serve Thai restaurant chains running their own
  supply chain? Requests outside that — other industries, other countries' tax rules, general CRM —
  are declined or left to integration.
- Reaching level 2 makes some engineering disciplines part of scope from the start rather than later:
  versioned releases with release notes, database migrations that are tested against a copy of the
  previous release's data, a documented upgrade path, and installation and operating guides.
- Real users decide priorities after the first release. PaynEat POS already has its first real user,
  and the ERP should seek one chain willing to pilot it.
- The comparison with Odoo is stated honestly wherever it is made: narrower, deeper in one field, fully
  open, and designed to sit next to the tools a chain already has.

## Alternatives considered

- **Aim for Odoo-level breadth.** Rejected: not achievable by one maintainer, and the attempt would
  undermine the credibility this project exists to establish.
- **Build a module for Odoo instead of a standalone ERP.** Rejected for now: it would tie the domain model
  to another product's data model and release cycle, and the ecosystem (POS, Cwork, SherWhyve) is built
  around standalone systems that integrate by contract. Export to Odoo keeps that door open without the
  dependency.

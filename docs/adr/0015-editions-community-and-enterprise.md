# ADR-0015: Editions — a free Community edition people can run, and a paid Enterprise edition

- **Status:** Accepted
- **Date:** 2026-09-25
- **Supersedes:** decision 4 of ADR-0012 ("no paid edition") only
- **ภาษาไทย:** [0015-editions-community-and-enterprise.th.md](0015-editions-community-and-enterprise.th.md)

## Context

ADR-0012 promised everything open under Apache 2.0 with no paid edition. The owner now wants the
business model that sustains Odoo and similar products: a free edition that is genuinely good enough
to download and run, which also serves as the public portfolio, and a paid edition for the needs that
larger chains will pay for.

Three facts constrain the design:

- Code already published under Apache 2.0 stays Apache 2.0 for everyone who received it. Nothing that
  is free today can become paid, legally or credibly.
- The project is built by one maintainer with one dev session. Two codebases with two CI pipelines
  would halve delivery speed.
- The owner's first goal is still to prove skill in public. Paid code that nobody can read does not
  help that goal.

## Decision

1. **Two editions of PaynEat ERP.**

   | | Community | Enterprise |
   |---|---|---|
   | License | Apache 2.0 | Source-available under the Elastic License 2.0 (ELv2), activated by a license key |
   | Price | Free | Paid subscription |
   | Where the code lives | The repository, outside `ee/` | `ee/` in the same public repository |

2. **Community is complete for one chain, not a demo.** It contains everything in the v1 specification
   (#1) and every later improvement to the supplier-to-plate path: the ledger, lots and expiry,
   costing, inspection, production, transfers, requisitions, MRP-lite, recall tracing, stock counts,
   period close, exports, the POS integration, Thai and English, and the public API, tokens and
   webhooks of ADR-0013. There are no limits on users, locations, items or documents.
3. **Never behind a paywall**, in any edition, ever:
   - food safety and data integrity: expiry blocking, recall tracing, the append-only ledger,
     segregation of duties, the audit trail;
   - basic security, including multi-factor sign-in and security fixes;
   - a chain's access to its own data, including full export;
   - the documented, tested upgrade path (ADR-0012 level 2).

   **A Community feature is never moved to Enterprise.**
4. **Enterprise is for needs that grow with scale, regulation or running cost.** The first candidates,
   to be confirmed with a pilot chain before any is built:
   - **Several companies and plants:** several legal entities in one installation, inter-company
     transfers and pricing, planning across plants.
   - **Food-safety programme:** HACCP critical-control-point monitoring, temperature logging from
     sensors, supplier quality scorecards and certificates, and timed mock-recall drills with
     audit-ready reports.
   - **Exact branch traceability:** pack scanning with GS1 barcodes, replacing inferred FEFO
     allocation at branches. Community keeps the honest candidate-lot recall of ADR-0006.
   - **Finance depth:** three-way matching with revaluation, landed cost allocated to lots, and
     standard cost with variance analysis.
   - **Mobile app** for receiving, counting and dispatch.
   - **Ready-made connectors** to specific accounting products. Community keeps the generic exports.
   - **AI agents** that cost money to run: demand forecasting and purchase timing, and the variance
     investigator (ADR-0011).
   - **Enterprise identity:** single sign-on (SAML, OIDC) and user provisioning.
   - **Labour cost** from Cwork absorbed into production cost.
5. **Paid services, for either edition:**
   - hosting ("PaynEat Cloud");
   - managed upgrades, and migration from other systems;
   - support with a service level;
   - implementation and training.
6. **Priced per active location** (plant, warehouse or branch) per month, **never per user**.
   Restaurants employ many short-tenure staff, and per-user pricing pushes chains to share logins, which
   would break the audit trail and segregation of duties (ADR-0008). Amounts are set with the first
   pilot, not guessed.
7. **How the code is arranged:**
   - Enterprise code lives in `ee/` and depends on the core. **The core never imports from `ee/`**,
     enforced by the architecture check.
   - `ee/` is first-party code, tested in the same CI and released with the same version. ADR-0013
     forbids third-party in-process code; it does not apply to `ee/`.
   - The ledger rule (ADR-0003, ADR-0010) applies to `ee/` like any other module.
   - The license key is signed and verified offline, with no phone-home: a branch may be offline, and
     the chain's data is not ours to watch.
   - An expired key makes Enterprise screens read-only. It never blocks core operations, posting or
     access to data, so no chain's data is ever held hostage.
8. **Timing.**
   - v1 is **entirely Community**. The weeks 1–6 plan and issues #2 onwards do not change.
   - No `ee/` code is written until v1 is released and a pilot chain exists. The product owner then
     publishes Enterprise issues.
9. **PaynEat POS stays entirely Community.** Its paid offering is services only (POS `DECISIONS.md`
   #67). Enterprise features that reach the till arrive through the ERP.
10. **Before the first sale:** a lawyer reviews the ELv2 notice and the commercial terms, and the
    PaynEat name is registered as a trademark. With the code open, the brand and the service are what
    is actually sold.

## Consequences

- The portfolio stays fully visible: every line of both editions can be read in one public repository.
- Community users get a real product, and the "never" list in decision 3 is public, so trust does not
  depend on promises made in private.
- Anyone may host Community for others; Apache 2.0 allows it. ELv2 forbids offering `ee/` as a hosted
  service without a license. This is accepted.
- Each new feature needs a tier decision, made by the product owner with the rules in decisions 2–4
  and recorded on its issue.
- The README gains an "Editions" section, and the glossary gains the terms.

## Alternatives considered

- **Stay fully free (ADR-0012 as written).** Rejected by the owner: it leaves no way to sustain the
  project.
- **A separate, closed repository for paid code.** Rejected: it hides the best work from the
  portfolio and doubles CI and release effort for one maintainer.
- **Per-user pricing, as Odoo does.** Rejected for the audit-trail reason in decision 6.
- **Relicense the core under AGPL to stop others from hosting it.** Rejected: code already published
  under Apache 2.0 stays Apache 2.0, the POS is Apache 2.0, and switching licences costs more trust than
  it protects.
- **Limit Community by users, locations or data volume.** Rejected: that would make it a trial, not a
  product, which is exactly what the owner does not want people to think of it.

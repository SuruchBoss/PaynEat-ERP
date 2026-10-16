# ADR-0031: PaynEat POS editions — Community for good, and a Pro edition for new work

- **Status:** Accepted
- **Date:** 2026-10-16
- **Supersedes:** decision 9 of ADR-0015 ("PaynEat POS stays entirely Community") only
- **ภาษาไทย:** [0031-pos-editions-community-and-pro.th.md](0031-pos-editions-community-and-pro.th.md)

## Context

ADR-0015 decision 9 says PaynEat POS stays entirely Community and that its paid offering is services
only, citing POS `DECISIONS.md` #67. The POS has since replaced #67 with POS `DECISIONS.md` #102
(SuruchBoss/PaynEat#170, in force since `main` `84e1169`, tagged `community-baseline-2026-10`): the
POS now has a Community edition and a Pro edition.

Decision 9 here therefore no longer describes the ecosystem, and this ERP's ADRs are where the
boundary between the two products is written down. ADR-0015 is accepted, so its text is not edited
to change its meaning; this ADR replaces decision 9 and nothing else. Every other decision of
ADR-0015 stands as written. The POS's own decision is POS `DECISIONS.md` #102; where this ADR and
#102 disagree about the POS, #102 wins and this ADR is corrected.

## Decision

Decision 9 of ADR-0015 is replaced by the following.

1. **PaynEat POS has a Community edition and a Pro edition** ("PaynEat POS Pro").
2. **Everything the POS does at the tag `community-baseline-2026-10` stays Apache 2.0 and Community
   for good**, including what sounds advanced: several branches (POS ticket 11), members and points
   (09), takeaway and delivery (10), AI questions about the shop's data (15), exports and the
   Z-report (12), and tax invoices (07). Pro holds only code written after that tag.
3. **The POS "never" list**, matching ADR-0015 decision 3, holds in every POS edition, for new work
   as well as old: selling, payment, the cash drawer, shift close, receipts and tax invoices,
   refunds, the audit log, basic stock, offline mode, printing receipts and sending orders to the
   kitchen, export of the shop's own data, bug fixes, security fixes and security work, and one shop
   using all of it without limits on devices or users.
4. **Work that keeps money correct or stops data from being lost is always Community** (the kind of
   work in POS `DECISIONS.md` #93 and #99), whenever it is written.
5. **POS Pro code follows the same rules as this ERP's `ee/`:** it is under the Elastic License 2.0;
   the POS core never imports it; a license key is verified offline; and an expired key never blocks
   a sale, a payment or access to the shop's data. It accepts only code the owner wrote or holds a
   copyright agreement for.
6. **Where POS Pro code lives is not decided.** It may be an `ee/` directory in the public POS
   repository under ELv2, or a separate private repository. POS `DECISIONS.md` #102 leaves this open;
   it is decided, and recorded there, before the first line of Pro code is written.
7. **What needs the supply side stays ERP Enterprise.** Stock across locations, lots, costing and the
   plant are this ERP's; POS Pro is for shops that run the POS on its own, so one feature is never
   sold in both products. Enterprise features that reach the till still arrive through the ERP.
8. **No POS Pro code before** the POS pre-launch gate (POS `DECISIONS.md` #99) is passed and a shop
   asks for a Pro feature.
9. **ADR-0015 decision 10** (a lawyer reviews the ELv2 notice and the commercial terms, and the
   trademark is registered, before the first sale) covers POS Pro as well.

How POS Pro is sold and priced is the POS's decision (#102) and is not repeated here.

## Consequences

- ADR-0015 decision 9 is no longer in force; the index marks it superseded by this ADR. Its other
  decisions, including decision 3's "never" list for this ERP, are unchanged.
- The ecosystem's paid line is now: ERP Enterprise for what grows with a chain's supply side, POS Pro
  for new till-side work for shops that run the POS alone, and services for either.
- Nothing changes in this repository's code or `ee/`. The ERP never reads or writes the POS database
  (ADR-0002), whichever POS edition a chain runs.
- The glossary gains "PaynEat POS Pro".

## Alternatives considered

- **Edit decision 9 of ADR-0015 in place, as an amendment.** Rejected: an accepted ADR is not edited
  to change its meaning (`README.md` in this directory); a new ADR that supersedes one decision keeps
  the history readable, as ADR-0015 did for ADR-0012 decision 4.
- **Keep the POS entirely Community.** Already rejected in the POS itself by #102; this ERP records
  the boundary, it does not decide the POS's business model.
- **Record POS Pro as living in the POS repository's `ee/`.** Rejected: #102 has not decided that, and
  writing it here would claim a decision nobody made.

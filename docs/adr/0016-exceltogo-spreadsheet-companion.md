# ADR-0016: ExcelToGo joins the ecosystem as the spreadsheet companion

- **Status:** Accepted; decision 6 (deployment model) extended by [ADR-0020](0020-distribution-and-installation.md)
- **Date:** 2026-09-26
- **ภาษาไทย:** [0016-exceltogo-spreadsheet-companion.th.md](0016-exceltogo-spreadsheet-companion.th.md)

## Context

Two things stand between this ERP and real chains (ADR-0012 level 2), and both live in spreadsheets:

- **Onboarding.** A chain arrives with its items, units, recipes, BOMs, par levels and opening stock in
  Excel. Without a good way in, nobody switches.
- **Finance reporting.** Finance teams work in Excel and will keep doing so; they want stock value,
  consumption cost and variances where their own formulas are.

[ExcelToGo](https://github.com/SuruchBoss/ExcelToGo) is an Apache 2.0 spreadsheet web app by the same
owner. It keeps an imported `.xlsx` intact, reads a protected workbook as a fill-in template, refuses an
invalid value before it is written, keeps sheets in the browser, and can refresh cells from a REST API
through its own server (paginated, rate-limit aware, with credentials encrypted at rest). It was invited
into the ecosystem and accepted; its product owner checked every claim against its code and corrected
two, which are reflected below.

## Decision

1. **ExcelToGo is the ecosystem's spreadsheet companion.** It stays a standalone product under its own
   rules ("everywhere, required nowhere"): nothing PaynEat-specific appears unless someone opens an ERP
   template or configures an ERP source. ADR-0015's editions apply to the ERP, not to ExcelToGo.
2. **Onboarding goes by file, never by API call.**
   - The **ERP owns the import templates**: sheets, columns, rules, and hidden, locked reference sheets
     (units, location codes, item codes) generated from its current master data.
   - A person fills the template in ExcelToGo (or in Excel), downloads the `.xlsx` and uploads it to the
     ERP. **The ERP re-validates every row** and reports errors per row; it never trusts the file.
   - ExcelToGo therefore holds no ERP token with write scope, and sheets never leave the browser.
     Sending data straight from ExcelToGo to the ERP would be a new decision.
   - Reference sheets use ecosystem codes exactly as the ERP issues them; nobody translates codes.
3. **Reporting reads the public API, by polling.** ExcelToGo is the first consumer of the ADR-0013 public
   API. It does not receive webhooks, so **everything a report needs is readable through the API**,
   never only through webhooks. The API is designed to fit ExcelToGo's existing pagination follower:
   - list responses are `{ "data": [...], "next": "<absolute URL on the same host>" }`, with `next: null`
     on the last page;
   - rate limiting answers `429` with `Retry-After` in seconds;
   - list endpoints accept page sizes of at least 2,500 rows;
   - each request carries its own `x-request-id` (`TELEMETRY.md`).
4. **Report data gets narrow scopes.** An ExcelToGo source belongs to its whole deployment: the ERP's
   audit trail sees the integration, not which accountant asked, and every holder of that deployment's
   operator token sees what the source returns. So report endpoints get **scopes of their own, split by
   sensitivity** (for example stock quantities separately from cost and valuation), narrower than
   `items:read`. The installation guide says this plainly, so chains do not discover it later.
5. **Never the ERP's database.** ExcelToGo can connect to PostgreSQL directly, but using that against the
   ERP is forbidden (ADR-0013). ExcelToGo cannot enforce this in code, because its host list belongs to its
   operator, so the ERP enforces it as well: the installation guide binds the ERP database to the ERP's own
   network, with a database role that accepts only the ERP application.
6. **Deployment model.** The ERP is **one central server per chain, self-hosted**: on the chain's own
   private network or on a cloud VM. Both are supported. ExcelToGo is self-hosted for this purpose too
   (the public demo cannot store sources). Reaching an ERP on a private network is ExcelToGo's decision:
   it chose an operator-listed set of exact private hosts, with loopback, link-local and metadata
   addresses still always blocked. That is a decision, not yet a feature; installation guides refer to it
   only once ExcelToGo confirms it has shipped (decision 7).
7. **Timing.**
   - Import templates: designed now, built **after v1 and before a pilot chain starts**. ExcelToGo has
     fixes of its own to make first (cross-sheet list references and their round-trip).
   - Live reporting: after the public API exists **and** after ExcelToGo's product owner confirms its side
     is ready. The ERP does not open this integration earlier.
   - `x-request-id` from ExcelToGo: any time.

## Consequences

- The ERP gains an onboarding path and a reporting path without building a spreadsheet, and the first
  real test of ADR-0013's "extend from outside" is a product rather than an example.
- The public API has a first consumer before it is designed, so its pagination and rate limiting are
  chosen once, against real code.
- A draft template and its generator live in `docs/integrations/exceltogo/`; they are a design sample,
  not a contract, until the importer ticket fixes the format.
- The scope list for the public API must include report scopes split by sensitivity.
- Installation guides must cover the database binding in decision 5 and the token caveat in decision 4.

## Alternatives considered

- **Build a spreadsheet-like import screen in the ERP.** Rejected: large effort for something ExcelToGo and
  Excel already do, and it would still not be where finance teams work.
- **ExcelToGo calls the ERP's import endpoint directly.** Deferred: it would need a write-scoped token in a
  deployment-wide source and would move sheet data off the browser. The file path keeps both properties.
- **Webhooks to ExcelToGo.** Rejected for now: ExcelToGo has no receiver and reports refresh on demand.
- **Read the ERP database for reports.** Rejected by ADR-0013.

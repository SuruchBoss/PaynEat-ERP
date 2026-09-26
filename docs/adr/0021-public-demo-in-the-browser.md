# ADR-0021: A public demo of the console that runs in the browser, on the backend's own rules

- **Status:** Accepted
- **Date:** 2026-09-26
- **ภาษาไทย:** [0021-public-demo-in-the-browser.th.md](0021-public-demo-in-the-browser.th.md)

## Context

Nobody can try the ERP without Docker. PaynEat POS has a public demo on GitHub Pages that anyone
can open; the owner wants the same for the ERP console (#41), and chose it over a hosted install
(the handoff after #34, options A and B).

GitHub Pages serves static files only: no API and no database. So a demo there must answer the
console's requests inside the browser. That is the risk this ADR is about. A second
implementation of the domain in the browser would drift from the real one, and a visitor would
then see behaviour the ERP does not have — presenting something untrue as the product, which
CLAUDE.md forbids.

[ADR-0020](0020-distribution-and-installation.md) decision 2.2 places "a public online demo" after
the pilot. That means a **hosted** demo, with the real API and a real database. This ADR does not
change it: it adds a static demo now, and the hosted demo with real data still comes after the
pilot.

## Decision

1. **A public demo of the console, on GitHub Pages**, at `https://suruchboss.github.io/PaynEat-ERP/`.
   It is the console's own code, built with `VITE_ERP_DEMO=1`. The console's API client is
   unchanged. An in-browser demo API sits in front of `fetch` and answers `/api/v1/*` and `/health`,
   so tokens, refreshes, request ids and error handling all run as they do on a real installation.
   No request leaves the origin.
2. **The data is the demo seed's fictional chain and nothing else.** The demo imports the very
   module the backend's seed builds from (`backend/prisma/demo-data.ts`). The one part it cannot
   import, the unit catalogue (created by a migration), is checked against that migration by a
   test. The data is held in memory for one visit, and a reload starts from the seed again. The
   signed-in session survives a reload; only the published demo accounts exist.
3. **The demo is not a second implementation of the domain.**
   - **Every business rule that is a pure function is imported from the backend, never rewritten.**
     These are the `domain/` files (exact decimals and stock value, business dates, location codes
     and supersede rules, purchase units, Thai tax ids, password policy, opening-balance lines and
     posting refusals, the ledger's negative-stock rule, reversals, lot numbers) and
     `core/security/permissions.ts`. A lint rule fences which backend files the demo may import.
     CI builds the demo on every pull request, so a backend rule the demo can no longer import
     fails there, not on the live site.
   - **What the demo writes itself is only what the backend's services do around those rules**:
     the order of the checks, the error codes and details, and the response shapes. It also
     mirrors the DTOs' request-shape checks. Tests exercise each screen's writes and refusals.
   - **Where the demo cannot run a rule faithfully, it says so, with `NOT_IN_DEMO`, and never
     approximates.** The console shows "not in the demo yet". The one rule it cannot import is the
     second-factor code: the backend signs with Node's crypto, which a browser does not have. The
     demo computes the same RFC 6238 code on Web Crypto. A test checks it against the backend
     function itself and the RFC's test vectors.
   - Some things are missing from the demo because no screen shows them: the audit trail, the
     master data change log, rate limits, password hashing. The passwords are published anyway.
4. **Scope over time: the demo covers the screens that exist when it ships, and later tickets may
   extend it but are not required to.** At #41 these are status, users and roles, items, locations,
   suppliers, stock on hand and opening balances. The demo API answers any path it does not serve
   with `NOT_IN_DEMO`, so a screen added later says "not in the demo yet" instead of failing some
   other way. No ticket inherits an unstated obligation; a ticket that extends the demo says so.
5. **It is always recognisable as a demo.** The demo installation banner (#5) is on every screen,
   and it adds that there is no server and that changes are not kept. The sign-in screen lists the
   published demo accounts and the admin's recovery codes.
6. **A normal build carries none of it.** The demo is loaded only behind a build-time constant, by
   a dynamic import that a normal build removes. CI checks both builds with
   `web/scripts/check-demo-build.mjs`:
   - the demo API's marker and the published credentials appear in the demo build only;
   - the demo build has its policy `<meta>` and a `404.html`.
7. **GitHub Pages specifics.**
   - The base path is `/PaynEat-ERP/` (Vite `base` plus the router's `basename`).
   - `404.html` is a copy of `index.html`, so a deep link such as `/PaynEat-ERP/items` opens the
     console. Pages still answers it with status 404, which only shows in the browser's developer
     tools.
   - Pages sends no response headers of ours, so `web/security-headers.conf` does not apply. The
     demo carries that file's Content-Security-Policy as a `<meta>`, **without `frame-ancestors`**,
     which a `<meta>` cannot carry. The demo can therefore be framed by another site, and
     `X-Frame-Options`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` are not set. This is
     accepted: the demo holds no real data and no credential beyond the published ones.
8. **Deployed by `.github/workflows/deploy-pages.yml`** on every push to `main` that changes the
   console or the backend files the demo imports, and on demand. It publishes only a build whose
   tests pass. The owner switches Pages on once (Settings → Pages → Source: GitHub Actions).

## Consequences

- The backend's pure rule files are now shared with the console, so **they must stay pure and use
  only TypeScript that compiles by erasing types** (no parameter properties or enums). #41 moved
  the demo data out of `prisma/seed.ts` into `prisma/demo-data.ts`, and gave `ConversionError` a
  plain field instead of a parameter property, without changing behaviour.
- The web console's Docker image is built from the repository root, because its typecheck sees the
  backend files the demo imports. `web/Dockerfile.dockerignore` keeps the build context to `web/`
  and those files. The image itself contains no demo code.
- When an API behaviour behind an existing screen changes, `web/src/demo` changes in the same pull
  request: the rules come across by themselves, and the orchestration does not. CLAUDE.md says so.
- In-transit locations appear in the demo exactly where the real console shows them: the locations
  list and stock on hand. They are never offered where a stockable location is expected, and they
  never enter the master data change log. Only branches take master data versions (#6), and the
  demo runs the same code for both.
- About 2,700 lines of demo code, most of them the services' orchestration and response shapes.

## Alternatives considered

- **A hosted demo with the real API and database, now.** Rejected for now; it is ADR-0020's
  post-pilot demo. It needs a server, a domain, TLS, secrets, running costs, a reset schedule and
  abuse handling, before one chain uses the ERP.
- **Copy the rules into the console.** Rejected: every copy can drift from the backend, and the
  drift would be shown to visitors as the product.
- **A mocking library (Mock Service Worker) or recorded responses.** Rejected: a new dependency and
  a service worker the future installable console (ADR-0020) would have to live with. Recorded
  answers cannot refuse a new input the way the rules do.
- **Run the NestJS backend itself in the browser**, with an in-browser database. Rejected: NestJS,
  Prisma and argon2 do not run in a browser, and making them run would cost far more than the demo
  is worth.
- **Screenshots and a video only.** Rejected: nothing to try.

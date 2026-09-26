# ADR-0020: Distribution and installation — an installable console, a server a chain can install without a developer, and PaynEat Cloud later

- **Status:** Accepted
- **Date:** 2026-09-26
- **ภาษาไทย:** [0020-distribution-and-installation.th.md](0020-distribution-and-installation.th.md)

## Context

Today the ERP is installed by cloning the repository and running commands. That is fine for evaluating
the project and useless for a restaurant chain: nobody at a chain will run `git pull` or `npm run`.
Level 2 of ADR-0012 ("in production at several chains") is out of reach until a chain can install,
open and upgrade the ERP without a developer.

Two different things have to be easy, and they have different answers:

- **The screens people use**: on a PC at head office, a tablet in the plant, a phone at the back door.
  The console is already one web app that works at every width (#34).
- **The server**: one central server per chain (ADR-0016 decision 6), with PostgreSQL, backups and
  upgrades. This is the hard part, and the one that decides whether a chain can run the ERP at all.

ADR-0015 already lists hosting ("PaynEat Cloud") as a paid service, and a dedicated mobile app for
receiving, counting and dispatch as an Enterprise candidate. This ADR places distribution alongside
both without contradicting either.

## Decision

1. **The console is installable as a Progressive Web App, from v1.** A person opens the chain's ERP
   address and installs it from the browser onto Android, iPhone, iPad, Windows or macOS. It opens full
   screen with the PaynEat ERP icon. The same code and the same release serve all of them, and they
   update when the server does.
   - The service worker caches **only the application shell** (HTML, scripts, styles, icons). **It never
     caches an API response.** A stock figure shown from a cache would be an old number presented as the
     current one. Offline, the console says it has no connection; it does not show stale data.
   - The installable console is **Community**: it is the Community console, installed. A dedicated
     native app with offline receiving, counting and scanning remains the Enterprise candidate of
     ADR-0015 decision 4.
2. **The server is installed without a developer, in stages** (option "D"):
   1. **After v1, before the pilot chain** (all Community, because installation, backups and the upgrade
      path are never behind a paywall, ADR-0015 decision 3):
      - **First-run setup in the console.** On an empty database, the console walks an administrator
        through the company, the first admin account with its second factor, and the first locations.
        No command line and no demo seed (ADR-0015, #5).
      - **A one-command installer and ready-made server images**: for a cloud VM, and for a machine on
        the chain's own network. They set up automatic backups, and upgrades run from a button in the
        console using the tested upgrade path (#28).
      - **An Android app in Google Play** wrapping the installable console (a Trusted Web Activity), if
        the pilot chain wants it. It asks for the chain's ERP address on first start.
   2. **After the pilot chain:**
      - **PaynEat Cloud**, the paid hosting service of ADR-0015 decision 5: the same Community software,
        run by us for chains without IT staff.
      - An **iOS app in the App Store** only if chains need it. Apple usually refuses an app that only
        wraps a website, so it needs a real native reason to exist.
      - A public online demo.
3. **Self-hosting stays the default and is always supported** (ADR-0016 decision 6 is extended, not
   replaced). A chain on PaynEat Cloud can take a full export of its data and move to its own server at
   any time, and a self-hosted chain can move to the cloud. The software, the data format and the
   upgrade path are the same in both.
4. **No Windows installer (`.exe`) for the server.** A PC at head office is switched off, updated and
   replaced by people who do not know it holds the chain's books. A chain that only has Windows runs
   the server image in a VM or uses PaynEat Cloud. A Windows PC is still a perfectly good *client*: it
   installs the console from the browser (decision 1).
5. **Distribution of PaynEat POS is the POS's own decision.** The POS is a Flutter app that already
   builds for Android, iOS and Windows, and it runs in the restaurant; its store listings are decided in
   its repository.

## Consequences

- v1 gains one small ticket (the installable console) and keeps its six-week scope.
- The post-v1 order in #1 gains "installation without a developer" as a prerequisite for the pilot
  chain, next to the import templates.
- Running PaynEat Cloud makes us responsible for other chains' servers, backups, security and personal
  data (PDPA). It is started only after the pilot shows what running it costs.
- A chain is never locked in: leaving the cloud is an export and an install, both documented.

## Alternatives considered

- **Native apps for every platform now.** Rejected: several codebases and store reviews for a UI that
  already works in every browser, before a single chain uses it.
- **A Windows `.exe` server installer.** Rejected for the reasons in decision 4.
- **Cloud only (no self-hosting).** Rejected: it contradicts ADR-0016 and ADR-0015's promise that a
  chain can always reach and keep its own data, and some chains will require their data on their own
  network.
- **Self-hosting only, installed by hand.** Rejected: it keeps the ERP out of reach of every chain
  without IT staff, which is most of them.

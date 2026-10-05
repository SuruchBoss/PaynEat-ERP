# Contract changelog

## 1.1.0 — ERP #16

Additive to 1.0.0: a POS written for 1.0 keeps working and simply skips the new kinds.

- `GET /api/v1/master-data/changes` gains five `entityType` values:
  - `menu_item`: menu items, by the `menuItemCode` sales events carry;
  - `menu_price`: prices from an effective-from date, chain-wide or per branch by location code; a
    branch row with `price: null` returns that branch to the chain-wide price;
  - `modifier_group`: groups with all their options, by the `modifiers[].code` sales events carry;
  - `menu_recipe` and `modifier_recipe`: versioned recipes, which a POS may skip.
- `GET /api/v1/pos/instance` serves `contractVersion: "1.1.0"`.
- The prose gains "The menu": what the POS does with each kind, the price rule, and theoretical
  usage = option recipe × modifier quantity × line quantity (or `weightKg`).
- No change to sales events, errors, telemetry names or transport.

## Clarified in 1.0.0 (2026-09-28, ERP #60)

- Documentation only; the version stays 1.0.0, and no schema or endpoint changes.
- New "Transport" section in `README.md`: the machine credential travels only over HTTPS, except to
  loopback or where the POS operator has allowed plain HTTP for a closed network. Certificates are
  always verified. Agreed with the POS PO (PaynEat `docs/DECISIONS.md` #82, ticket 32).

## 1.0.0 — ERP #9

- `GET /api/v1/pos/instance`: the instance's code and the branches it serves.
- `GET /api/v1/master-data/changes`: items and branches, paginated by version (the change log of
  ERP #5 and #6, now described here and authenticated by the machine credential).
- `POST /api/v1/sales-events`: sales event v1, stored exactly once by idempotency key.
- Machine credentials (`pnepos_…`), refusals by `reason`, telemetry per docs/TELEMETRY.md v1.2.

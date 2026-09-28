# Contract changelog

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

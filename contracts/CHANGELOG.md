# Contract changelog

## 1.0.0 — ERP #9

- `GET /api/v1/pos/instance`: the instance's code and the branches it serves.
- `GET /api/v1/master-data/changes`: items and branches, paginated by version (the change log of
  ERP #5 and #6, now described here and authenticated by the machine credential).
- `POST /api/v1/sales-events`: sales event v1, stored exactly once by idempotency key.
- Machine credentials (`pnepos_…`), refusals by `reason`, telemetry per docs/TELEMETRY.md v1.2.

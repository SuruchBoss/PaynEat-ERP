# Telemetry contract v1 — PaynEat ERP, PaynEat POS, Cwork

What every service in the ecosystem writes to its logs and metrics, so that one investigator —
SherWhyve — can follow an incident across all of them with the same queries (ADR-0011). It is a
contract: renaming a field, a label or a metric is a breaking change and needs a new version here.

The shapes are chosen for Google Cloud, where SherWhyve's live connectors run: JSON written to stdout
by a container on GKE is parsed by Cloud Logging, and Prometheus metrics are collected by Managed
Service for Prometheus into Cloud Monitoring. Off Google Cloud, the same output works with any JSON
log pipeline and any Prometheus scraper.

## Logs

One JSON object per line on stdout.

| Field | Required | Meaning |
|---|---|---|
| `severity` | yes | One of `DEBUG`, `INFO`, `NOTICE`, `WARNING`, `ERROR`, `CRITICAL`. **Named `severity`, as a string** — Cloud Logging ignores a numeric `level`, and `severity>=WARNING` filters would silently find nothing. |
| `time` | yes | RFC 3339 timestamp with milliseconds. |
| `message` | yes | Human-readable sentence. |
| `event` | yes | Dot-named event type from the catalogue below, e.g. `ledger.posting.refused`. |
| `logging.googleapis.com/labels` | yes | Object of string labels, filterable as `labels.<name>`. Always contains `app` and `correlation_id`; the others when they apply. |
| `logging.googleapis.com/trace` | when present | `projects/<project>/traces/<trace-id>` from an incoming W3C `traceparent`. |
| `httpRequest` | on `http.request.completed` | Cloud Logging's request object: `requestMethod`, `requestUrl` (path only, no query string), `status`, `latency`. |
| `error` | on failures | `{ "type", "message" }`. Stack traces only at `DEBUG`. |

### Labels

| Label | Values |
|---|---|
| `app` | `payneat-erp-api`, `payneat-erp-web`, `payneat-pos-api`, `cwork-api`, … |
| `correlation_id` | See "Correlation" below. |
| `location_code` | The ecosystem location code (same in ERP, POS and Cwork). |
| `document_number` | ERP document number, when the line concerns one. |
| `pos_instance` | Registered POS instance id, on integration traffic. |
| `rule` | The rule that refused something, e.g. `negative_stock_plant`, `expired_lot`, `self_approval`, `period_closed`. |
| `reason` | Rejection reason for an integration event, e.g. `schema_invalid`, `branch_not_served`, `credential_revoked`. |

### Correlation

- **HTTP:** the `x-request-id` header (the name Cwork already uses). Accepted from the caller if it
  matches `^[\w-]{8,64}$`, otherwise generated; returned in the response; present on every log line
  the request produces, and in error bodies.
- **POS sales events:** the event's **idempotency key** is its correlation id, from the POS outbox
  through delivery (sent as `x-request-id`) to the ERP lines that store and later consume it.
- **Documents:** `document_number` is labelled on every line about the document; `correlation_id`
  stays the id of the request acting on it.

### Event catalogue (v1)

| Event | Emitted by | Severity |
|---|---|---|
| `http.request.completed` | every API | `INFO`; `WARNING` for 4xx except 401/404; `ERROR` for 5xx |
| `auth.sign_in.failed` | ERP, Cwork | `WARNING` |
| `ledger.posting.succeeded` | ERP | `INFO` |
| `ledger.posting.refused` | ERP | `WARNING`, with `rule` |
| `document.approved` / `document.rejected` | ERP | `INFO` |
| `sales_event.received` / `sales_event.duplicate` | ERP | `INFO` |
| `sales_event.rejected` | ERP | `WARNING`, with `reason` |
| `master_data.pulled` | ERP | `INFO`, with `pos_instance` |
| `outbox.delivery.failed` | POS (and any service with an outbox) | `WARNING`; `ERROR` when dead-lettered |

## Metrics

Prometheus exposition at `GET /metrics` on each API, not exposed publicly.

| Metric | Type | Labels | Emitted by |
|---|---|---|---|
| `http_requests_total` | counter | `app`, `method`, `route`, `status` | every API |
| `http_request_duration_seconds` | histogram | `app`, `method`, `route` | every API |
| `auth_sign_in_failures_total` | counter | `app` | ERP, Cwork |
| `erp_postings_total` | counter | `document_type`, `outcome`, `rule` | ERP |
| `erp_sales_events_total` | counter | `outcome` (`received`, `duplicate`, `rejected`), `reason` | ERP |
| `erp_master_data_last_pull_timestamp_seconds` | gauge | `pos_instance` | ERP |
| `erp_negative_branch_balances` | gauge | `location_code` | ERP |
| `outbox_pending_events` | gauge | `app`, `destination` | POS, Cwork |
| `outbox_oldest_pending_age_seconds` | gauge | `app`, `destination` | POS, Cwork |

`route` is the route template (`/documents/:id`), never the concrete path.

## Never in logs or labels

Passwords, tokens, machine credentials, MFA codes or secrets; personal data (names, phone numbers,
national ID numbers, bank details, salaries); full request or response bodies; query strings.
Identify people by internal user id only.

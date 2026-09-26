# Telemetry contract v1.2 — PaynEat ERP, PaynEat POS, Cwork

What every service in the ecosystem writes to its logs and metrics, so that one investigator —
SherWhyve — can follow an incident across all of them with the same queries (ADR-0011). It is a
contract: renaming a field, a label or a metric is a breaking change and needs a new version here.

Every project in the ecosystem is self-hostable on its own, so **the default output carries no vendor
names**. A deployment on Google Cloud — where SherWhyve's live connectors run — switches on one setting,
`LOG_FORMAT=gcp`, and the same information moves to the keys Cloud Logging reads specially. Prometheus
metrics are identical everywhere; on Google Cloud, Managed Service for Prometheus collects them into
Cloud Monitoring.

## Clarification to v1.2 (2026-09-26, no change to what any service emits)

- The label values of `erp_postings_total` are now written down (see "Metrics"). The ERP's first
  implementation (#7) already emits exactly these; nothing is renamed.

## Changes in v1.2 (2026-09-26)

All additive; nothing in v1.1 is renamed, so the ERP walking skeleton (#2) needs no change. Proposed by
SherWhyve after building lab stand-ins, where each point was a behaviour it had to guess.

- New section "POS↔ERP integration lines": which labels every integration line carries, including
  failures, and that a request refused at authentication is still a `sales_event.rejected`.
- `erp_master_data_last_pull_timestamp_seconds` is read from the database, not held in process memory.
- New reason `credential_unknown`.
- `app.log` added for lines that are not one of the catalogue's events (proposed by the ERP's first
  implementation, #2).
- On Kubernetes, the metrics port is named `metrics`, not `http`, because `/metrics` has its own port.
- `sales_event.processed` and `sales_event.failed` added to the catalogue now, rather than by the ticket
  that implements them (ERP #17), so the investigator's playbooks can be written against them.

## Changes in v1.1 (2026-09-25, before any service implemented v1)

- Labels are written as a plain `labels` object by default; `logging.googleapis.com/labels` and
  `logging.googleapis.com/trace` are used only with `LOG_FORMAT=gcp` (proposed by Cwork: self-hosters
  should not see a cloud vendor's keys in their own logs).
- `event` moved into the labels, so it can be filtered and counted (proposed by SherWhyve).
- `httpRequest.latency` is fixed as a duration string such as `"0.231s"` (proposed by SherWhyve; Cloud
  Logging rejects a number there).
- Correlation behind a gateway: see "Correlation".

## Logs

One JSON object per line on stdout.

| Field | Required | Meaning |
|---|---|---|
| `severity` | yes | One of `DEBUG`, `INFO`, `NOTICE`, `WARNING`, `ERROR`, `CRITICAL`. **Named `severity`, as a string** — Cloud Logging ignores a numeric `level`, and `severity>=WARNING` filters would silently find nothing. |
| `time` | yes | RFC 3339 timestamp with milliseconds. |
| `message` | yes | Human-readable sentence. |
| `labels` | yes | Object of string labels. Always contains `app`, `event` and `correlation_id`; the others when they apply. **With `LOG_FORMAT=gcp` this object is written under `logging.googleapis.com/labels` instead**, which Cloud Logging turns into filterable `labels.<name>`. |
| `trace` | when present | The trace id from an incoming W3C `traceparent`. **With `LOG_FORMAT=gcp`** it is written as `logging.googleapis.com/trace` in the form `projects/<project>/traces/<trace-id>`. |
| `httpRequest` | on `http.request.completed` | `requestMethod`, `requestUrl` (path only, no query string), `status`, and `latency` **as a duration string with an `s` suffix**, e.g. `"0.231s"`. |
| `error` | on failures | `{ "type", "message" }`. Stack traces only at `DEBUG`. |

### Labels

| Label | Values |
|---|---|
| `app` | `payneat-erp-api`, `payneat-erp-web`, `payneat-pos-api`, `cwork-api`, … A lab stand-in that shares one of these names (SherWhyve's lab has its own `cwork-api`, which is not Cwork) must never run in the same project as the real service. |
| `event` | Dot-named event type from the catalogue below, e.g. `ledger.posting.refused`. |
| `correlation_id` | See "Correlation" below. |
| `location_code` | The ecosystem location code (same in ERP, POS and Cwork). |
| `document_number` | ERP document number, when the line concerns one. |
| `pos_instance` | Registered POS instance id, on integration traffic. |
| `rule` | The rule that refused something, e.g. `negative_stock_plant`, `expired_lot`, `self_approval`, `period_closed`. |
| `reason` | Rejection or failure reason for an integration event, e.g. `schema_invalid`, `branch_not_served`, `credential_revoked`, `credential_unknown`, `unknown_menu_item`, `no_recipe_in_effect`. |

### Correlation

- **HTTP:** the `x-request-id` header (the name Cwork already uses). Accepted from the caller if it
  matches `^[\w-]{8,64}$`, otherwise generated; returned in the response; present on every log line
  the request produces, and in error bodies.
- **POS sales events:** the event's **idempotency key** is its correlation id, from the POS outbox
  through delivery (sent as `x-request-id`) to the ERP lines that store and later consume it.
- **Documents:** `document_number` is labelled on every line about the document; `correlation_id`
  stays the id of the request acting on it.
- **Behind a gateway:** services read only `x-request-id`. The ecosystem's own design puts no gateway
  between its services (POS calls the ERP directly, ADR-0002). A deployment that adds one — for example
  an API manager that tracks requests under its own header, as WSO2 does with `activityid` — configures
  the gateway to forward that same value as `x-request-id`, so gateway and service logs share one id.
  Vendor headers are not added to the services themselves.

### POS↔ERP integration lines

Every log line about POS↔ERP traffic — on either side, **including lines about failures** — carries
`pos_instance` and, when the line concerns one branch, `location_code`. This covers the ERP's
`http.request.completed` for the sales-event and master-data endpoints, `sales_event.*`,
`master_data.pulled` and a refused pull, and the POS's `outbox.delivery.failed`. A label is left out only
when its value cannot be known (a credential the ERP has never issued has no `pos_instance`); it is never
filled with a guess.

**A request refused at authentication is still an integration event.** When the ERP refuses a sales
event because the machine credential is revoked or unknown, it does not stop at a bare 401 in middleware:
it writes `sales_event.rejected` with `reason` `credential_revoked` (and the `pos_instance` the credential
belonged to) or `credential_unknown`, with the request's `x-request-id` — the event's idempotency key — as
`correlation_id`, and counts it in `erp_sales_events_total`. A refused master-data pull is logged the same
way with the same reasons. Nothing from the credential itself is logged.

### Event catalogue (v1.2)

| Event | Emitted by | Severity |
|---|---|---|
| `app.log` | every service | As fits the line. For lines that are not one of the events below (start-up, shutdown, configuration); never for something the catalogue names |
| `http.request.completed` | every API | `INFO`; `WARNING` for 4xx except 401/404; `ERROR` for 5xx |
| `auth.sign_in.failed` | ERP, Cwork | `WARNING` |
| `ledger.posting.succeeded` | ERP | `INFO` |
| `ledger.posting.refused` | ERP | `WARNING`, with `rule` |
| `document.approved` / `document.rejected` | ERP | `INFO` |
| `sales_event.received` / `sales_event.duplicate` | ERP | `INFO` |
| `sales_event.rejected` | ERP | `WARNING`, with `reason` |
| `sales_event.processed` | ERP | `INFO` — the event became branch consumption |
| `sales_event.failed` | ERP | `WARNING`, with `reason` — received but could not become consumption (ERP #17) |
| `master_data.pulled` | ERP | `INFO`, with `pos_instance` |
| `outbox.delivery.failed` | POS (and any service with an outbox) | `WARNING`; `ERROR` when dead-lettered |

## Where each service runs, and what an investigator can see

| Service | Runs | Visible to SherWhyve on Google Cloud |
|---|---|---|
| PaynEat ERP | One central server per chain, self-hosted: on the chain's own private network or on a cloud VM (ADR-0016) | Everything in this contract when it runs on Google Cloud; otherwise only what the chain chooses to ship there |
| Cwork | One central server per organisation, self-hosted in the same way | Same as the ERP |
| PaynEat POS | **In the restaurant** (one-line Docker install; printers and scales on the shop LAN) | **Not by default** — its logs and metrics stay in the shop |

Because the POS side is usually out of sight, the ERP's own evidence is what explains most POS→ERP
incidents: `erp_sales_events_total` per outcome and reason, `erp_master_data_last_pull_timestamp_seconds`
per `pos_instance`, and the `sales_event.*` log lines. When the answer depends on the POS side, the
investigator says that evidence is unavailable rather than guessing. Test labs run the POS on the same
cluster as the ERP so both sides are visible. None of these services sits behind an API gateway by design
(ADR-0002).

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

`erp_postings_total` label values:

- `document_type`: the ERP's stock document type, as stored: `opening_balance` and `reversal` so far.
  Each ticket that adds a document type adds its value here.
- `outcome`: `succeeded` or `refused`.
- `rule`: the rule that refused the posting (for example `negative_stock_plant`, `expired_lot`,
  `period_closed`); empty when `outcome` is `succeeded`.

Values that describe the system rather than one process are **read from the database at scrape time**,
never held in process memory. `erp_master_data_last_pull_timestamp_seconds` is the stored time of each
instance's last successful pull: in memory, several ERP replicas would each report a different value, and
a restart would blank it until the next pull — both of which look exactly like a POS that stopped pulling.

**On Kubernetes** (the SherWhyve lab, and any Google Kubernetes Engine deployment), metrics are collected
by Managed Service for Prometheus through a `PodMonitoring` resource. For that to find a service:

- its pods carry the label `app: <app>`, with the same value as the `app` log label (`payneat-erp-api`,
  `payneat-pos-api`, `cwork-api`, …);
- the container port that serves `/metrics` is named `metrics`. Services serve `/metrics` on a port of
  their own (the ERP uses `METRICS_PORT`, 9464), so it is never published with the API.

This is a deployment convention, not a change to what services emit; a pod without it is simply not
scraped, and an investigator then reports its metrics as missing, never as zero.

## Never in logs or labels

Passwords, tokens, machine credentials, MFA codes or secrets; personal data (names, phone numbers,
national ID numbers, bank details, salaries); full request or response bodies; query strings.
Identify people by internal user id only.

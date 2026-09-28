# PaynEat ERP ↔ PaynEat POS contract

**Version 1.0.0** · ภาษาไทย: [README.th.md](README.th.md)

This folder is the integration contract between PaynEat ERP and PaynEat POS (ADR-0002). It is the
source of truth: the ERP is built to it, the POS is built to it, and **both repositories test
against these files in CI**. The ERP validates every example here and uses the sales-event schema to
check what it receives; the POS validates the events it produces and the ERP answers it parses.

| File | What it is |
|---|---|
| [`pos/v1/openapi.yaml`](pos/v1/openapi.yaml) | The three endpoints a POS calls, their answers and errors |
| [`pos/v1/sales-event.schema.json`](pos/v1/sales-event.schema.json) | **Sales event v1**: one paid sale line, POS → ERP |
| [`pos/v1/sales-event-receipt.schema.json`](pos/v1/sales-event-receipt.schema.json) | The ERP's answer to a stored event (first time or duplicate) |
| [`pos/v1/master-data-changes.schema.json`](pos/v1/master-data-changes.schema.json) | **Master-data change v1**: one page of changes since a version, ERP → POS |
| [`pos/v1/pos-instance.schema.json`](pos/v1/pos-instance.schema.json) | Who the instance is and which branches it serves |
| [`pos/v1/error.schema.json`](pos/v1/error.schema.json) | Every refusal, with the `reason` the POS acts on |
| [`pos/v1/examples/`](pos/v1/examples) | Valid examples of each, and invalid sales events (`invalid/`) that must be refused |

The prose below is part of the contract: it says **when** a POS calls what, and what it does with
each answer. The POS tickets built on it are `25-erp-connected-mode`, `26-erp-sales-outbox` and
`28-erp-connect-from-config` in the PaynEat POS repository.

## Connecting a POS instance

1. An ERP administrator registers the instance: a code (for example `POS-SILOM-1`, the ecosystem
   code shape `^[A-Z0-9][A-Z0-9-]{1,31}$`), a name, and the branches it serves. The ERP shows the
   **machine credential once** (it starts with `pnepos_`). It can be revoked, and a new one issued;
   both are in the ERP's audit trail.
2. The POS administrator enters the ERP's address and the credential. The POS keeps the credential
   secret: never in a log line, an answer to the app, a screen after saving, or an export.
3. Every call sends `Authorization: Bearer <credential>` and an `x-request-id`.
4. The POS reads `GET /api/v1/pos/instance`: its own code (which every sales event names) and the
   branches it serves, by ecosystem location code. A POS branch whose code does not match any of
   them cannot sell in connected mode.

A `401` with `POS_CREDENTIAL_REJECTED` on any call means the credential was revoked
(`credential_revoked`) or never existed (`credential_unknown`). Retrying cannot help: the POS stops
calling the ERP, keeps every sale waiting to be sent, and tells its administrator; it resumes when a
new credential is saved. The ERP logs and counts every such refusal, so the chain's investigator sees
it too.

### Transport

**The POS sends its machine credential only over HTTPS**, except:
- to a loopback address; or
- when the POS server's operator has explicitly allowed plain HTTP for a closed network, such as the
  one-command demo of ERP #27.

The allowance is a server setting (on the POS, `ERP_ALLOW_INSECURE_HTTP=true` in the backend
environment). It can never be turned on from a screen, and while it is on, the POS shows a
permanent warning. Otherwise an `http://` ERP address is refused when it is saved.

Certificates are always verified. An ERP that uses a chain's internal certificate authority
(ERP #60) needs that authority trusted on the POS server. It is never switched off.

## Master data: pull by version

- Master data flows ERP → POS only. In contract 1.0 that is **items** (mirrored as ingredients,
  matched by `itemCode`) and **branches** (matched by `locationCode`). Menu items, prices, options
  and recipes arrive in contract 1.1 (ERP #16).
- Every change takes the next company-wide version. Versions are committed in order: a reader never
  sees version N+1 before N.
- The POS stores the last version it applied (0 before its first pull) and calls
  `GET /api/v1/master-data/changes?since=<that version>`. It applies the page **in version order**,
  stores the last version applied, and calls again while `hasMore` is true. It pulls on a schedule
  and when a person asks it to. An instance that was offline for a day simply catches up.
- `data` is the whole record after the change: overwrite the mirror, never merge.
- Nothing is ever deleted. An item or branch no longer in use arrives with `active: false`.
- A branch whose code turned out wrong after it was used is **superseded**: it arrives inactive with
  `supersededBy`, naming the branch that replaces it. The POS moves that branch to the new code and
  keeps its sales history.
- **Forward compatibility.** A POS skips any `entityType` it does not know and ignores fields it
  does not know. Contract 1.x only ever adds them, so a POS written for 1.0 keeps working with 1.1.
- Each successful pull is the instance's "last pull" in the ERP. The chain's investigator watches
  `erp_master_data_last_pull_timestamp_seconds{pos_instance}` to see a POS that stopped pulling.

## Sales events: an outbox, delivered exactly once

**When a sales event exists.** When a **sale line is paid** (its bill is paid in full, or a payment
covering that line is made, as when a bill is split), the POS creates one sales event for that line,
if it was not cancelled:

- `saleTime` is that payment's time, with its UTC offset.
- A line sold by count carries `quantity`. A line sold by weight carries `weightKg`, the weight
  actually sold, in kilograms. Never both.
- `menuItemCode` and each modifier's `code` are the ERP's codes (mirrored with contract 1.1). A
  menu item without an ERP code cannot be sold in connected mode, so no line lacks one.
- Modifiers are included. A modifier's `quantity` is **per one unit sold on the line**: per piece
  for `quantity`, per kilogram for `weightKg`. The ingredients used are the option's recipe × the
  modifier's `quantity` × the line's `quantity` (or `weightKg`).
- **Not sent in v1:** refunds or voids after payment, and food prepared but cancelled before
  payment. Stock counts absorb that difference (PaynEat POS `docs/DECISIONS.md` #66). No event has
  a negative or zero quantity.

**The outbox.** The POS writes each event to an outbox table **in the same database transaction as
the payment**: if the payment fails, there is no event, and if it succeeds, the event cannot be
lost. A POS in standalone mode writes nothing.

**The idempotency key** identifies the sale line: stable across every retry, and unique across the
chain. **The key must stay unique even if the POS database is reinstalled**, so it carries an id of
the database as well as the order item: `<pos-instance>-<6-character database id>-<order-item id,
8 digits>`, for example `POS-SILOM-1-K3F9Q2-00001234` (at most 48 characters). It is also the event's
**correlation id** (docs/TELEMETRY.md), so it is sent as `x-request-id` on every delivery, and that is
why it keeps to that header's characters: `^[A-Za-z0-9_-]{8,64}$`. A colon is not one of them, so use
`-` between the parts. There is no second id: the ERP's log lines about the event, the POS's lines
about delivering it, and both metrics' investigations all follow this one value.

**Delivery.** A background sender drains the outbox in order, one event per
`POST /api/v1/sales-events`, and acts on each answer:

| Answer | Meaning | The POS |
|---|---|---|
| `201` | Stored | Marks the row sent |
| `200`, `duplicate: true` | Already stored (an earlier try arrived); nothing stored again | Marks the row sent |
| `422` `SALES_EVENT_REJECTED` | Will never be accepted as it is; `details.reason` says why. Nothing was stored | Moves the row to its dead letters, with the reason, for a person to look at |
| `401` `POS_CREDENTIAL_REJECTED` | The credential is revoked or unknown | Stops the whole queue, keeps every pending row pending, and alerts an administrator. Resumes when a new credential is saved |
| `429` | Too many requests from this address | Waits `Retry-After` seconds, then retries |
| `5xx`, timeout, no network | The ERP could not answer | Retries forever with a capped exponential backoff (the POS caps it at 5 minutes), the same key each time; on a `503` with `Retry-After`, waits that long. Never dead-letters: `outbox_oldest_pending_age_seconds` raises the alarm |
| Any other status (`400`, `403`, `404`, `405`, `413`…), or a `2xx` whose body is not a valid receipt | A configuration problem: a wrong address, a proxy, a contract version mismatch | As on `401`: stops the whole queue, keeps every pending row pending, and alerts an administrator. Never dead-letters. Resumes when a new address or credential is saved |

**Dead letters come from `422` only.** A refusal does not use up the key: a `422` stores nothing, so
once its cause is fixed (for example, the instance now serves that branch), the same event resent
from the dead letters with the same key is accepted as new (`201`). The one exception is
`idempotency_key_reused`, whose key already belongs to another sale line.

**The ERP stores each idempotency key exactly once**, even when the same event arrives several
times at the same moment. It checks, in this order:

1. the credential (`credential_revoked`, `credential_unknown`);
2. the schema (`schema_invalid`, with `details.errors`);
3. that `posInstance` is the credential's own instance (`pos_instance_mismatch`);
4. that the branch is one the instance serves (`branch_not_served`);
5. that a key seen before carries the same event (`idempotency_key_reused` when it does not: a key
   is never reused for a different sale line).

A stored event is `received`. Turning it into ingredient usage, with the recipes in effect at
`saleTime`, is the ERP's job from ERP #17. The POS never waits for it, and a sale is never refused
because of stock.

## Telemetry

Both sides follow [docs/TELEMETRY.md](../docs/TELEMETRY.md) v1.2, "POS↔ERP integration lines".
Every log line about this traffic carries `pos_instance` and, when it concerns one branch,
`location_code`, including the lines about failures. A label is left out only when its value cannot
be known, never guessed.

The ERP writes and counts:

| Signal | What it is |
|---|---|
| `sales_event.received` / `sales_event.duplicate` | Lines about stored events; `correlation_id` is the idempotency key |
| `sales_event.rejected` | Refused events, with `reason` |
| `erp_sales_events_total{outcome, reason}` | Every event by outcome |
| `master_data.pulled` | Successful pulls |
| `master_data.pull_refused` | Refused pulls, with `reason` |
| `erp_master_data_last_pull_timestamp_seconds{pos_instance}` | The last successful pull of each instance, read from the database |

The POS writes `outbox.delivery.failed` and the `outbox_*` gauges; `outbox_oldest_pending_age_seconds`
is the one that shows sales waiting because the ERP cannot be reached.

## Versioning

The contract has a semver version, served as `contractVersion` by `GET /api/v1/pos/instance`:

- **Minor** (1.0 → 1.1): only adds endpoints, optional fields, entity types or enum values the
  receiver can ignore.
- **Major** (2.0): anything else. It gets its own `pos/v2/` folder, and the ERP serves both until
  every POS has moved.

Every change is recorded in [CHANGELOG.md](CHANGELOG.md). A change to anything in this folder is
reviewed by the product owner before it merges.

---
name: Maintenance-mode write lock
description: How the maintenance system mode locks DB writes at the connection level and the sanctioned escape
---

The rule: when the system mode is "maintenance", the app enforces `default_transaction_read_only = on` per pool **checkout** — the pool's `acquire` event fires on every checkout (new or reused connection), and a SET issued there queues ahead of the triggering query. Do NOT rely on the `connect` event or on recycling idle clients: a connection checked out during the mode change keeps its old session state when released, and returning to the pool fires no hook, so connect-only enforcement leaves stale writable (or stale read-only) connections indefinitely.

**Why:** operators run big imports/migrations while the app is locked; connection-level enforcement catches every server write path (routes, crons, event pump) without per-route code. Enforcement is armed only from the shared boot path, so standalone tsx scripts stay writable.

**How to apply:**
- The only sanctioned override is `allowInMaintenanceMode`: its own transaction whose FIRST statement is `SET LOCAL transaction_read_only = off` (Postgres rejects it after any other statement). Wrapped call sites: session persistence writes (login/expiry/logout/prune) and the system-mode escape write. Do not wrap anything else — failing writes is the point.
- Track the applied state on the client object and only re-SET on mismatch, so steady state is a property check, not a round-trip.
- Storage logging middleware swallows its own log-write failures, so failing log INSERTs during maintenance don't break requests.

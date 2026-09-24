---
name: Maintenance-mode write lock and external-service refusal
description: How the maintenance system mode locks DB writes at the connection level, refuses outbound vendor calls, and the one sanctioned escape (DB only)
---

The rule: when the system mode is "maintenance", the app enforces `default_transaction_read_only = on` per pool **checkout** — the pool's `acquire` event fires on every checkout (new or reused connection), and a SET issued there queues ahead of the triggering query. Do NOT rely on the `connect` event or on recycling idle clients: a connection checked out during the mode change keeps its old session state when released, and returning to the pool fires no hook, so connect-only enforcement leaves stale writable (or stale read-only) connections indefinitely.

**Why:** operators run big imports/migrations while the app is locked; connection-level enforcement catches every server write path (routes, crons, event pump) without per-route code. Enforcement is armed only from the shared boot path, so standalone tsx scripts stay writable.

**How to apply:**
- The only sanctioned override is `allowInMaintenanceMode`: its own transaction whose FIRST statement is `SET LOCAL transaction_read_only = off` (Postgres rejects it after any other statement). Wrapped call sites: session persistence writes (login/expiry/logout/prune) and the system-mode escape write. Do not wrap anything else — failing writes is the point.
- Track the applied state on the client object and only re-SET on mismatch, so steady state is a property check, not a round-trip.
- Storage logging middleware swallows its own log-write failures, so failing log INSERTs during maintenance don't break requests.

## The other half: outbound vendor calls

A write lock only covers the reversible half. An SMS, an email, a mailed letter and a metered geocode cannot be rolled back when maintenance ends, so maintenance ALSO refuses every server-side call to the external comms/geo vendors, before the network call and before any credential is read.

**Why:** the flag lives in its own import-free module precisely so a vendor wrapper can read it without pulling in the connection pool. Guard and write lock therefore share ONE boolean and can never disagree; the refusal is also free (no per-call system-mode read) and flips live with the same boot-armed refresh.

**How to apply:**
- The guard is a plain statement at the top of the operation — ahead of credential resolution and OUTSIDE the method's own try/catch. Several of these methods convert any failure into a normal-looking answer (empty template list, "not deliverable" address, local-fallback validation); a refusal caught by one of those is indistinguishable from a vendor outage.
- Any layer that falls back or flattens errors into a result object (address validator, best-effort geocode, comm senders) must re-throw the refusal by type, or the honest 503 becomes a generic 500 / a silent success.
- Non-vendor external calls that live in the same files (OpenStates, US Census, the Replit connector credential endpoint) are deliberately NOT gated — they are named per-function in the lint rule's exemption table, never per-file.
- There is NO escape hatch for vendors. `allowInMaintenanceMode` unlocks the database only.
- Coverage is enforced by an architecture-lint rule with two halves: no outbound call inside a listed vendor module without the guard, and no *unlisted* server file naming a vendor endpoint or SDK. The second half is what catches a fifth wrapper appearing next to the others.

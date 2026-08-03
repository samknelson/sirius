---
name: Accepted-primary ⇒ not_available invariant
description: How the dispatch "accepted primary ⇒ worker not available" hard rule is enforced, and tx/retry pitfalls
---

The rule "worker on an accepted PRIMARY dispatch ⇒ dispatch status not_available" is a hard invariant, enforced in three layers:
1. `storage.dispatches.create/update/setStatus` flip the worker to not_available inside `runInTransaction` with the dispatch write.
2. Worker-status storage writes throw `WorkerOnPrimaryDispatchError` for any write that leaves the worker "available" while holding an accepted primary — including implicit defaults (create/upsert with no status defaults to "available"). Routes map it to 409.
3. The `dispatch_primary_unavailable` denorm plugin has NO event handlers; its backfill is an integrity scan for violators only.

**Why:** the previous event-driven path was async and could be missed; direct `update()` was also a bypass.

**How to apply / pitfalls:**
- A unique-violation catch-and-retry CANNOT live inside one Postgres transaction (tx is aborted after the error). Pattern used: wrap each attempt in its own `runInTransaction` and retry as a fresh transaction.
- `storage.denorm.insertStaleBatch` is now ON CONFLICT DO UPDATE (re-marks existing rows stale) so violation scans can re-enqueue entities that already have a computed denorm row; safe for other plugins because their backfills anti-join on "no denorm row".
- Any new dispatch write path that can produce status=accepted+isPrimary must call the same flip helper in-transaction.

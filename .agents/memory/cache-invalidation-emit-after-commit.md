---
name: Cache-invalidating events must emit after commit
description: Why storage-layer events that invalidate an in-memory cache must defer to onAfterCommit, not fire mid-transaction.
---

# Cache-invalidating events must emit after commit

A storage method that emits an event to invalidate an in-memory cache must defer
that emit until **after** the surrounding transaction commits. Use
`onAfterCommit(cb)` from `server/storage/transaction-context.ts` (runs the
callback immediately when there is no active transaction).

**Why:** If the emit fires mid-transaction, the bus handler invalidates the
cache slice while the write is still uncommitted. A concurrent read can then
rebuild the cache from the *pre-commit* (committed) state — i.e. without the
in-flight row, because the rebuild's query runs outside the writer's
transaction — and stamp that stale snapshot. After commit there is no further
invalidation, so the staleness **persists until the next write** (not
self-healing). A per-kind generation guard does NOT fix this: the invalidation
happened before the rebuild, not during it.

**How to apply:** This only matters for emits that invalidate a cache whose
rebuild reads the DB. Notification-style emits (the codebase has many
fire-and-forget `eventBus.emit` calls in storage, e.g. WORKER_BAN_SAVED,
HOURS_SAVED) tolerate mid-transaction firing because they don't persist derived
state. `runInTransaction` flushes the after-commit queue only on successful
commit; a rollback throws and the callbacks never run. Nested
`runInTransaction` calls share the outermost queue.

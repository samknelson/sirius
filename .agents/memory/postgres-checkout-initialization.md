---
name: Postgres checkout initialization
description: How to order per-session setup before a pooled PostgreSQL client reaches its borrower.
---

Pool `acquire` and `connect` event listeners are synchronous notifications, not
awaitable checkout hooks. Do not start a session query from either event and
assume the borrower waits for it.

**Why:** The borrower can issue its first query while that setup query is still
active on the same client. `pg` 8 queues this with a deprecation warning; `pg` 9
is expected to reject the overlap.

**How to apply:** Put async per-session setup in the public pool `connect`
handoff and deliver the checked-out client only after setup settles. Preserve
the same client and release callback so transaction and ownership semantics do
not change. Remember that `pool.query()` also checks out through `connect()`.
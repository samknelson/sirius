---
name: Advisory-lock check-then-write guard
description: Race-proofing search-before-write uniqueness checks when a DB unique index can't express the invariant (comma-joined token lists, cross-table tuples)
---

Rule: when a uniqueness invariant can't be a plain unique index — e.g. a comma-joined
multi-value column ("start,continue") whose tokens must be mutually exclusive, or a
tuple spanning base + subsidiary tables — make every writer (1) open the write
transaction, (2) take `pg_advisory_xact_lock(hashtext(key))` on a logical key scoped
to the contended set (e.g. kind + pluginId), (3) re-run the token-aware conflict scan
inside the transaction, (4) throw a typed error to roll back and map to a structured 409.

**Why:** a search before the transaction lets two simultaneous saves both pass and both
write. The xact lock is auto-released at commit/rollback, and under READ COMMITTED the
waiter's re-check statement sees the winner's committed rows.

**How to apply:** the lock helper lives on the storage layer (routes must not touch the
DB); it should refuse to run outside `runInTransaction`. Use ONE lock key for all write
paths touching the invariant (single create, patch, bulk ops), and acquire it before any
in-tx reads. Verify with a Promise.allSettled race test that inserts a sleep inside the
lock window (see scripts/oneoffs/test-phase-conflict-race.ts pattern).

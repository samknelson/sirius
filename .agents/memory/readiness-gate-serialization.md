---
name: Readiness-gate serialization via storage withX helper
description: How to make read-evidence→decide→transition sequences concurrency-safe using the ALS transaction context + per-worker advisory lock.
---

A computed "readiness" gate (read evidence, decide, then transition) is racy if the read and the transition are separate transactions — a concurrent evidence mutation can land between them.

**Rule:** expose a storage-level `withCaseSerialization(id, fn)` that opens `runInTransaction`, resolves the owning worker, takes the per-worker `pg_advisory_xact_lock`, then runs `fn`. Because `transaction-context.ts` is ALS-based, every nested storage call inside `fn` joins the SAME transaction, and the advisory lock is re-entrant in-session — so service code can compose multiple storage calls atomically without tx plumbing.

**Why:** DC case review — an approval's readiness recheck must see (or block on) a concurrent document supersede/reclassify; and an evidence mutation must commit atomically with its auto-bounce.

**How to apply:** wrap BOTH sides in the helper: the lifecycle action (recheck while holding the lock, immediately before transition) and every readiness-affecting mutation paired with its recompute/bounce (`mutateEvidenceAndRecompute`). Deterministic regression test: hold the lock in one `withCaseSerialization` with a sleep, fire the racing action, assert it blocked and then failed/succeeded against the committed state.

Also: generic entity-files adapters can't distinguish upload vs reclassify (verbs are only view/manage) — make the adapter's `update`/`remove` throw and route checklist-affecting mutations through dedicated staff-gated routes.

---
name: Migration runner does not wrap migrations in a transaction
description: Backfill/copy-then-delete migrations must self-wrap in db.transaction or risk data loss on rerun.
---

The migration runner runs each migration's `up()` directly and only persists the
version number on success — it does NOT open a transaction around `up()`. Every
`db.execute` inside a migration auto-commits individually.

**Why:** A backfill that copies data into new tables and then deletes/strips the
source is dangerous if it fails partway: the partial copies are already
committed. A naive "(parent,child) pair already exists → skip" idempotency check
will then skip the partially-copied group on rerun, and the later source-strip
runs anyway — permanently losing the un-copied rows.

**How to apply:** Any migration that (a) does multi-step inserts whose
correctness depends on completeness, or (b) deletes/strips a source after
copying, must wrap the entire body in `await db.transaction(async (tx) => { ... })`
and issue all statements via `tx.execute`. Then a partial failure rolls back
atomically, leaving the source intact for a clean rerun, and the
already-fully-migrated case is still skipped correctly.

**DDL corollary (table + its indexes):** Do NOT gate index creation behind a
single `if (!tableExists)` check. A crash after `CREATE TABLE` but before the
indexes leaves the table without its indexes, and the existence check then skips
index creation forever → missing uniqueness + drift-gate failure. Make each DDL
statement independently self-healing: `CREATE TABLE IF NOT EXISTS`,
`CREATE [UNIQUE] INDEX IF NOT EXISTS`, `ALTER TABLE ... DROP COLUMN IF EXISTS`.

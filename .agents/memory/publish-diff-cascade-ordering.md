---
name: Publish-diff CASCADE ordering bug & two-step publish workaround
description: Why a publish can fail with "constraint ... does not exist" on its own generated SQL, and how to unblock it without touching prod.
---

# Publish-time schema diff can generate a self-breaking script

The Publish flow diffs the dev DB against prod and applies the SQL in one
transaction. When dev has dropped a table AND a surviving table's FK to it,
the generated script can order `DROP TABLE <parent> CASCADE` BEFORE
`ALTER TABLE <child> DROP CONSTRAINT <fk>`. The CASCADE removes the FK, the
explicit DROP CONSTRAINT then fails, and the WHOLE migration rolls back —
every publish retry regenerates the identical script and fails the same way.
(Verify rollback by read-only prod queries: old tables/constraints still there.)

**Why:** the diff is DB-to-DB and platform-generated; we cannot edit or
reorder it, and prod is read-only outside the publish flow.

**How to apply (two-step publish):**
1. Temporarily resurrect the dropped parent table in dev — exact prod shape,
   WITHOUT the FK — via schema.ts + a proper core migration (drift gate).
   Next publish then emits only the FK drop (both sides have the table).
2. After that publish succeeds, drop the table again (migration + schema
   removal); the following publish emits `DROP TABLE` with no FK left in
   prod, so no broken pair.

# Core migration numbering must clear migrations_version, not the file list

Baseline scripts register as core migrations at high versions (e.g. a
baseline at 1042 while numbered core files stop at 1040). A new migration
numbered below the DB's `variables.migrations_version` value is silently
skipped as "already applied" ("No pending migrations"). Always check
`SELECT value FROM variables WHERE name='migrations_version'` (or the
baseline files' BASELINE_VERSION constants) and number above it.

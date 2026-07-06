---
name: Drizzle .unique() = constraint, not index (drift gate)
description: Why a migration creating a unique INDEX fails the startup drift gate when the schema column uses .unique()
---

A Drizzle column-level `.unique()` (e.g. `varchar("sirius_id").unique()`) declares
a named UNIQUE **constraint** (`<table>_<col>_unique`), NOT a unique index.

The startup schema-drift gate (`server/services/schema-drift-check.ts`) reflects
constraints and indexes as separate categories. A migration that creates a
`CREATE UNIQUE INDEX <table>_<col>_unique` satisfies the *index* set but leaves
the *constraint* "missing", and the gate refuses to boot with:
`missing constraints: UNIQUE <table>_<col>_unique: (col)`.

**Fix:** the migration must add the constraint, not an index:
`ALTER TABLE t ADD CONSTRAINT t_col_unique UNIQUE (col)`.

**Converting an existing plain index → constraint** (index name collides with the
constraint's backing index): drop the index first, then add the constraint, and
guard idempotently on `pg_constraint.conname` so a re-run is a no-op and the drop
never fires once the constraint owns the name:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 't_col_unique') THEN
    DROP INDEX IF EXISTS t_col_unique;
    ALTER TABLE t ADD CONSTRAINT t_col_unique UNIQUE (col);
  END IF;
END $$;
```

**Why:** the drift gate is the real enforcement (the author-time
`check-migrations.ts` false-fails on untracked migration files anyway). Match the
constraint/index KIND the Drizzle schema declares, not just the name.

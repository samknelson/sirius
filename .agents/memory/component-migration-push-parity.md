---
name: Component creation migration must match the enable-path push
description: A per-component CREATE TABLE migration and the component enable schema push must produce identical constraints; the push leaves foreign keys unnamed.
---

A schema-managing component's table is created by two paths that must converge:
the **enable-path push** of the Drizzle declaration (fresh installs) and the
**per-component migration** (existing deployments). If they disagree, migrated
deployments drift from freshly enabled ones.

The non-obvious divergence: **the push emits foreign keys unnamed**, so
Postgres names them `<table>_<col>_fkey` — not the Drizzle-style
`<table>_<col>_<target>_<targetcol>_fk`. Unique constraints, by contrast, keep
the name the Drizzle `unique("…")` declares.

So in the migration's `CREATE TABLE`: leave the FK inline and unnamed, and name
every UNIQUE constraint exactly as the schema declares it. (Uniqueness must
also be a CONSTRAINT rather than an INDEX — see
[Drizzle .unique()](drizzle-unique-constraint-vs-index.md).)

**Why:** the drift gate compares constraints and indexes by name and category,
so a name mismatch stays invisible until someone diffs two environments.

**How to apply:** measure, don't reason. Enable the component to let the push
build the table, snapshot `pg_constraint` + `pg_indexes`, `DROP` it, run the
migration's `up()`, snapshot again, and require the two to be equal. Then run
boot drift enforcement with the component enabled, and re-run `up()` once more
to prove the `tableExists` guard makes it idempotent.

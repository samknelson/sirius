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

Two more naming facts, measured 2026-09-04: an extraConfig
`foreignKey({ name })` builder IS emitted with that name by the push (only
inline `.references()` comes out unnamed), and an inline column `.unique()`
gets Drizzle's default `<table>_<column>_unique` — the migration must spell
that out as `CONSTRAINT <table>_<column>_unique UNIQUE (<column>)`.

**Manifest coverage is part of parity.** The push and the drift gate only see
`schemaManifest.tables`; a `pgTable` left out of the manifest is never pushed
and, because `shared/schema.ts` re-exports component schemas, is judged a
missing CORE table on every deployment without it. The
`component-manifest-coverage` lint rule now fails this at author time.

**Why:** the drift gate compares constraints and indexes by name and category,
so a name mismatch stays invisible until someone diffs two environments.

**How to apply:** measure, don't reason. Enable the component to let the push
build the table, snapshot `pg_constraint` + `pg_indexes`, `DROP` it, run the
migration's `up()`, snapshot again, and require the two to be equal. Then run
boot drift enforcement with the component enabled, and re-run `up()` once more
to prove the `tableExists` guard makes it idempotent.

Practical recipe that worked: build a scratch DB from a schema-only `pg_dump`
of dev plus the `variables` table data (`CREATE DATABASE … TEMPLATE` fails
while the running app holds connections), point a throwaway tsx script at it
via `DATABASE_URL` (refuse to run unless `current_database()` is the scratch
name), snapshot the migrated tables, `DROP` every manifest table + the
`component_schema_state_<id>` variable, call `enableComponentSchema(id)` —
which pushes in FK order and then replays migrations 001..N on the pushed
schema, proving each is idempotent — and diff the catalogs. Expect one
harmless pre-existing diff: Postgres renders a migration-written `CHECK … IN
(…)` differently from the push's `ARRAY[…]::text[]` spelling.

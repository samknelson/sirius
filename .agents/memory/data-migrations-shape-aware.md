---
name: Data-writing migrations must be shape-aware
description: INSERT/backfill migrations break when a fresh deployment's publish diff creates target tables at FINAL shape; DDL-idempotence guards are not enough.
---

# Data-writing migrations must be shape-aware

**Rule:** Any migration that INSERTs/copies data must probe the actual column
shape of both source and target (`information_schema.columns`) and branch,
because a deployment whose tables were created by the publish diff (not by
replaying migrations) already has the FINAL shape when older migrations run.

**Why:** A prod publish created `plugin_configs` at final shape
(`plugin_kind`), then boot replayed an old backfill migration that INSERTed
into the since-renamed `plugin_type` column → migration failed, drift gate
refused boot, prod crash-looped. DDL migrations were all guarded/idempotent;
only the data-writing ones were shape-dependent. Audit `INSERT INTO` in
migrations specifically.

**How to apply:**
- Branch on `columnExists(...)` for renamed/added columns; select optional
  legacy columns via conditional SQL fragments (`legacyHasX ? sql\`x\` : sql\`NULL\``).
- When the final shape has stricter constraints (e.g. NOT NULL account) apply
  the LATER migration's data policy at insert time (e.g. skip rows a later
  migration would delete) — never insert base rows without their subsidiary.
- Never orphan base rows in base+subsidiary table pairs.

Related: a stale `component_schema_state_<id>` claiming "active" while the
component's tables were never created is self-healable in a core migration by
guarding on the `components` variable + missing tables and calling
`pushComponentSchema(id)` (creates only missing tables, throws on drift).

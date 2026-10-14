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
- Historical repairs before a rename must resolve the live column name too:
  ordering the repair before the rename is not enough when Publish installs
  the renamed column first. Test the compiled SQL for both schema shapes,
  including cleanup predicates, not only its source text.

Historical CREATE migrations must recognize a renamed successor, not just
their original table name. A final-schema Publish followed by replay can
otherwise recreate the retired predecessor and make the later rename refuse
to run.

**Why:** startup recreated an empty legacy notes table beside its already
published successor, then stopped at the rename's ambiguity guard.

**How to apply:** skip legacy creation when the successor exists. If recovering
a previously failed replay, continue only when the legacy table is confirmed
empty; refuse nonempty or unreadable legacy data. Leave obsolete-table removal
to the normal Publish diff rather than adding startup DROP statements.

Related: a stale `component_schema_state_<id>` claiming "active" while the
component's tables were never created is self-healable in a core migration by
guarding on the `components` variable + missing tables and calling
`pushComponentSchema(id)` (creates only missing tables, throws on drift).

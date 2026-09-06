---
name: Core migrations vs optional components
description: Why a core startup migration must tolerate an optional component's tables being absent, how the guard is shaped, and the core-table-FK-to-component-table lifecycle trap.
---

# A core migration must never hard-depend on a component-owned table

A component's manifest tables only exist where that component is enabled, and most components default to off. A *core* migration runs on every deployment.

**Rule:** guard every core-migration reference to a component-owned table with a table-existence check that returns early when it is absent. Keep the enabled path byte-identical to what it was before the guard.

**Why:** this has bricked boots repeatedly — the runner stops at the first failure, so the database is left half-migrated, every later migration stays pending behind it, and the startup drift gate then refuses to boot. It always surfaces on a deployment other than the one the migration was written on, usually a fresh UAT/prod, which is the worst place to discover it.

**How to apply:**
- Shape the guard as probe → `if` → early return with a log line, naming the table in the probe. An architecture-lint rule in the `lint` gate enforces exactly that shape over the SQL each core migration executes. It is textual: it proves a named check is present and positioned before the first use, not that the code branches correctly, and it cannot see a Drizzle query builder or assembled SQL. Satisfying it is necessary, not sufficient.
- Same philosophy as the baselines' skippable-error handling: `relation "..." does not exist` while touching a component table is a normal condition, not a failure.
- Skipping costs nothing later: when the component is eventually enabled, schema-push creates its tables from the current Drizzle definition, columns and named indexes included. So the skip path only has to leave no drift — it must not "half-apply" anything.

## Retiring a column that a COMPONENT migration added

Two migrations, in two different series, and the split is not optional:

- The data move (e.g. seeding provenance out of the doomed column) is a **core** migration, guarded so it states a reason and writes nothing where the component is off.
- The `DROP COLUMN` belongs in the **component's own** series, not core. A deployment that enables the component later replays that series from version 0, so the earlier migration that ADDED the column runs again on a freshly pushed table; only a later migration in the same series takes it back off. A core drop would have run long before and would leave the column resurrected, and drifting.

Ordering is safe by construction: at boot the core runner finishes before `runPendingComponentMigrationsAtStartup`, which finishes before the drift gate. So core-seed → component-drop → gate all happen on the one restart.

## Lifecycle trap: a CORE table with an FK to a component table

If a core table's column references a component-owned table, the core migration that creates it must drop the FK on deployments where that component is off. Enabling the component later does NOT install the missing FK — component schema-push manages only that component's manifest tables — so the drift gate blocks boot afterwards, reporting the missing constraint.

It is a loud, gated failure rather than corruption, but a one-time migration cannot fix it (it already ran, before the component existed there). The repair is a fresh dated baseline that reinstalls the constraint idempotently; the real fix belongs in the component's enable flow.

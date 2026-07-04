---
name: Plugin-config subsidiary ownership & schema-managing transition
description: Which plugin_configs_* subsidiaries are component-owned vs core, and how the startup runner self-heals when a component becomes schema-managing while already enabled.
---

# Plugin-config subsidiary ownership

The core `plugin_configs` base table has per-kind subsidiary tables. Ownership is
split:

- **Component-owned** (created by component schema-push on enable, drift-checked
  only when the component is enabled, listed in the component's
  `schemaManifest.tables`):
  - `plugin_configs_dispatch` → `dispatch`
  - `plugin_configs_benefit_eligibility` → `trust.benefits`
- **Core** (always created, always drift-checked): `plugin_configs_charge`,
  `plugin_configs_event_notifier`, `plugin_configs_dashboard`,
  `plugin_configs_cron`, `plugin_configs_payment_gateway`.

**Why event_notifier stayed core:** it was originally proposed to move to an
`event` component but was explicitly descoped by the user. charge and
payment_gateway are entangled with the core ledger schema; dashboard and cron are
genuine core infra.

**How to apply:** a component-owned subsidiary's Drizzle definition lives in the
component's schema module (e.g. `shared/schema/trust/benefit-eligibility-schema.ts`)
and is re-exported from `shared/schema.ts` for import compatibility. Per-component
data/structure migrations live under `scripts/migrate/components/<id>/` and are
registered with `registerComponentMigration(id, migration)` (versioned per
component, independent of the core counter). They must be idempotent: on a
deployment where the component was already enabled under the old core-migration
layout, the relocated migration runs again under the per-component counter.

# Startup self-heal: component becomes schema-managing while already enabled

When a component that is **already enabled** on a deployment newly gains a
`schemaManifest` + component migrations, it has no `component_schema_state_<id>`
variable yet (that variable is normally created by the enable flow). The
per-component migration runner refuses to run migrations without that variable —
by design, so it never invents state and loses the table-state audit trail.

The startup runner (`runPendingComponentMigrationsAtStartup` in
`server/services/migration-runner.ts`) bridges this gap: for an enabled,
schema-managing component whose state variable is missing, it calls
`enableComponentSchema(id)` (the same primitive the enable flow uses) to create
the state (create-if-missing tables, reflect table state, preserve any existing
`migrationVersion`) and run pending migrations, then continues — instead of
throwing and blocking boot.

**Why:** this makes the "table moves from core to component" transition boot
cleanly on every already-enabled deployment (dev and prod) without authoring a
per-deployment baseline just to seed the state variable. `enableComponentSchema`
is idempotent for an already-present, drift-free table, so re-running is safe.

**How to apply:** any future task that adds `managesSchema`/`schemaManifest` to a
component that ships enabled (or is enabled somewhere) can rely on this — no
baseline needed solely to initialize `component_schema_state`. If the pre-existing
live table's shape does not match the new Drizzle definition, schema-push throws
`ComponentSchemaDriftError` and you must author a migration to reconcile it.

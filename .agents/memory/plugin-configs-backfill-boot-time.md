---
name: plugin_configs legacy backfill is boot-time, not SQL
description: Why dashboard plugin settings were backfilled at boot instead of via a migration, and the canonical-row rule.
---

# Backfilling legacy plugin settings into `plugin_configs`

When migrating a plugin kind off ad-hoc `variables` rows onto unified
`plugin_configs` rows, do the data backfill as a **boot-time idempotent step**
in the kind's init (e.g. `initializeDashboardPluginSystem` ->
`backfillFromLegacyVariables`), **not** as a SQL migration.

**Why:** the "settings exist but no enable-toggle var was ever stored" case must
set `enabled` to each plugin's `enabledByDefault`, which is plugin-*code*
knowledge the SQL layer cannot see. A pure SQL migration would have to guess and
could silently enable/disable a widget. Boot-time code knows each plugin's
default. No schema change happens, so no migration file is needed and the
startup drift gate / check-migrations stay quiet. This mirrors the pre-existing
`runLegacyMigrations` precedent for dashboard plugins.

**How to apply:**
- Idempotency: per plugin, skip if a `plugin_configs` row already exists; only
  create when legacy vars (or `migrateLegacySettings`) yield data.
- Retire old keys only for successfully-handled plugins + true orphans, so a
  per-plugin failure never deletes un-migrated data.
- Runtime "canonical" config for a plugin = the FIRST row by `(ordering, id)`
  (`storage.pluginConfigs.getByTypeAndPlugin`). The multi-config admin can
  create several rows per plugin; reads must resolve one deterministically.
- The generic `/admin/plugin-configs/:kind` screen renders settings from the
  manifest's `configSchema` (+ `uiSchema`), so `decorateEntries` must attach
  both for the kind to be usable there.

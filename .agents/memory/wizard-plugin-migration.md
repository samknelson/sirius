---
name: Wizard plugin migration — registry surfaces
description: Gotchas when moving a wizard from the legacy wizardRegistry into the plugin wizardPluginRegistry.
---

# Migrating a wizard out of the legacy registry

Moving a wizard from `server/wizards` (legacy `wizardRegistry`) into
`server/plugins/wizards` (`wizardPluginRegistry`) is not just the wizard
itself — audit every surface that *enumerates* the legacy registry.

**Rule:** any surface that lists wizards must merge BOTH registries, or a
migrated wizard silently disappears from it.
**Why:** the legacy dashboard/report surfaces were written against
`wizardRegistry.getAll()` only. When a wizard is deregistered from legacy
and registered as a plugin, those surfaces stop showing it with no error.
**How to apply:** when migrating, grep for `wizardRegistry.getAll()` /
`wizardRegistry` usages and confirm each also folds in
`wizardPluginRegistry.list()` (dedupe by id). Known surfaces: the
`/api/wizard-types` catalogue (already merges) and the reports dashboard
plugin (`server/plugins/dashboard/plugins/reports.ts`).

# Report result columns carry display types

Report `getColumns()` entries have a `type` (`link`, `date`, `boolean`,
`string`) and `link` cells are `{ url, label }` objects; some reports also
carry row-side arrays (e.g. `workerDetails`) and action columns (e.g.
`viewLink`).
**Why:** the generic framework `ResultsTable` must honor `type` — a plain
`String(value)` renders link cells as `[object Object]` and shows raw
booleans/ISO dates. CSV export must DROP `link`/`viewLink` columns (they
have no meaningful text form), matching the legacy ResultsStep.
**How to apply:** generic type-driven rendering (link/date/boolean) lives
in the framework `ResultsTable`; truly row-specific links (a `viewLink`
target route, per-worker links from `workerDetails`) belong in a bespoke
escape-hatch `ResultsTable` under `client/src/plugins/wizards/<type>/`
that wraps the framework one with a `renderCell` override.

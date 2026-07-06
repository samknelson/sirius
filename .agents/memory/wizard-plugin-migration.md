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

# A migrated wizard often must stay DUAL-registered

A wizard migrated to `wizardPluginRegistry` frequently cannot be
deregistered from the legacy `wizardRegistry` — some per-type sub-routes
are NOT plugin-aware and read only the legacy registry.
**Why:** `/api/wizard-types/:type/fields` calls
`wizardRegistry.getFieldsForType(type)` with no plugin fallback. A
framework step that fetches `/fields` (e.g. a benefits/column step) breaks
the instant the type leaves the legacy registry, even though load / create
/ dispatch all correctly prefer the plugin (the load route attaches a
`manifest` and the plugin WINS, so rendering still uses the framework body).
**How to apply:** keep the type registered in BOTH registries. The plugin
wins on load/create/dispatch (manifest-driven); the legacy registration
only backstops the non-plugin-aware `/fields` (and legacy `/launch-arguments`,
`/steps`, `/statuses`) sub-routes. Only remove the legacy registration once
those sub-routes are made plugin-aware. Deregistering prematurely is a
silent break, not a boot failure.

# Extraction verification

All runtime scenarios use disposable source copies and a separate local
PostgreSQL cluster with synthetic users and records. The workspace database,
saved switches and external vendors are not used. No source-deletion or browser
matrix is added to the permanent test suite.

## Completed checks

- Installed typechecks, all 16 architecture lint rules, migration validation,
  and browser/server production build passed.
- Focused existing flood, worker-deletion, metadata-seeding, ownership and plugin
  gate checks plus the small component authority tests passed: 7 files, 33 tests.
- Fresh enabled setup reached **ready** with drift **passed**, created the
  bookmark schema, and stamped normal global/component migration bookkeeping.
- Signed-in browser checks confirmed the page's three records, profile menu
  entry, worker/employer/company title buttons, and no uncaught exceptions.
  APIs confirmed effective-user record ownership, worker/employer enrichment,
  the existing generic company fallback, dashboard content, and flood HTTP 429.
- Disabled production startup reached **ready** with drift **passed**.
  With the bookmark table temporarily renamed after startup, all six feature
  API shapes and direct dashboard content refused access. Browser record pages
  remained usable without bookmark buttons/menu. Other dashboard content and
  account deletion still worked. Re-enabling restored the existing records.
  Records, provenance, plugin settings/roles, bookmark permission assignments
  and migration versions were compared before and after.
- Legacy disabled-owner upgrade reached **ready** with drift **passed**.
  The fixture included the historical metadata discriminator and bookmark date
  column, with the global counter before 1100. Original dates survived in
  provenance with unknown creator, then the old column was removed. Enabling
  adopted the existing table. A second fixture with the bookmark table absent
  also reached ready through the historical migrations and normal installation.
- Removing only the component directory in the disposable source copy,
  regenerating discovery, typechecking, running all architecture rules and
  rebuilding production succeeded. Core flood/deletion/metadata/ownership
  checks also passed without the source: 5 files, 28 tests.
- Source-absent production startup reached **ready** with drift **passed** both
  against retained bookmark data with a saved enabled switch and against an
  empty database. Direct feature API/dashboard addresses returned 404; retained
  ownership reported not-installed/unavailable without clearing the enabled
  switch. Browser record pages remained functional without contributions, and
  unrelated widget content and account deletion still worked. The retained
  table, provenance, settings, permission assignments and counters were unchanged.
- Guarded schema push recognized retained ownership and refused before launching
  any external schema tool. The temporary check additionally replaced child
  process spawning with a throwing stub, so it could not execute a schema push
  even if the retained-ownership guard regressed.
- Restoring the same directory, regenerating discovery, typechecking and
  rebuilding production succeeded. The retained-data deployment reached
  **ready** with drift **passed**, and API data and dashboard resolution
  recovered without resetting records, dates, plugin settings/roles, bookmark
  permission assignments, global counters or component migration versions.

## Final source inventory

- All feature implementation, schema/validation/types, storage/logging,
  routes, browser contributions, dashboard/flood plugins and executable
  historical migrations belong to this directory.
- Generated shared schema/definition, server schema/storage/startup/metadata/
  registration, client contribution and migration imports are expected bridges.
- Live handwritten core matches are limited to incidental browser-bookmark
  wording in `App.tsx` and SAML comments, and the generic icon-picker's
  `Bookmark` icon. There are no declared external feature consumers.
- `migrations/0000_wet_wallow.sql` remains a frozen mixed historical snapshot,
  not runtime schema ownership. It was not rewritten.
- The mixed dashboard visibility document stays in core with bookmark-specific
  expectations transferred to this component's README.

## Unchanged limitations

Company bookmarks still lack company-specific enrichment and links.
The `bookmark`/`admin` UI hint is still distinct from staff API/page authority.
Neither is silently changed by this extraction.

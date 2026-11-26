# EDLS ownership and compatibility

EDLS owns its schema, storage, routes, policies, browser pages, plugins, operator
scripts, tests and documentation below this directory. Its component ID remains
`edls`, independently enabled, with unchanged table/API/permission/tab/plugin,
event, token/context and stored configuration identities.

The four historical core migrations keep their original versions and core scope
through `coreMigrations`. The nine component migrations keep their component
scope, versions and ordering. Core provenance seeding must run before component
creator-column retirement. Disabled/absent source does not drop retained tables
or clear saved settings, snapshots, or migration history.

## Integration inventory

- Manifest discovery supplies schema, storage, metadata, shared/browser
  contributions, routes, startup registration and plugin imports.
- Startup registers modular policies and the enabled-only sheet entity loader,
  transactional snapshot capture, historical decoding/live-parent access,
  validated status-policy inputs and Reports menu gate extensions.
- Existing hooks supply tab entity policies and linked-communication access.
  Existing contributions supply menus, tabs, options and record-go metadata.
- Existing plugin registries supply dashboards, reports/wizards, notifiers,
  tokens, quicksearch, retention and flood handling.
- Browser plugin discovery uses existing `pluginViews` contributions to load
  dashboard/report inputs lazily under their original lookup keys. Snapshot
  renderers use the browser contribution.
- `worker.header.badges` displays status. `edls.crew.editor` and
  `edls.crew.detail` replace the former generic crew-specific contract; their
  prop type belongs to EDLS.
- Current-member-status population filtering joins the generic latest-status
  query to enabled EDLS workers in the database, without per-worker queries.
- Freeman owns its sync-result type extension and activation/deactivation
  behavior; the shared sync contract has no handwritten EDLS counters.
- Developer-check declarations preserve the `edls_sheets.changed` watermark
  exception and the read-only report engine's existing lint exemption.
  `changed` drives changed-since exports, ordering and notifications.

## Dependent components and removal

Freeman, its EDLS migration component, the T631 client, worker access tokens,
worker ratings and worker absences declare their EDLS dependency. Their
integrations, operation aliases and export contracts remain with those
components. Remove declared dependents before removing EDLS source;
removing EDLS alone while mandatory dependents remain is not supported.

Worker access tokens own public schedule presentation, access-token routes and
worker SMS notifiers; worker absences own absence views/routes; worker ratings
own rating controls/query contributions. These are declared integrations, not
duplicate EDLS implementations. EDLS retains assignment mutation, generation
checks, transactional snapshots and the worker selection host.

The owned `edls.workers.query-plan` alter carries SQL joins, selected rating
values, conditions, ordering and explicit availability/refusal, with
available-worker/directory request context. Its default has no optional-table
SQL and keeps NULL values/original ordering; unhandled explicit selections
refuse. Ratings contributes fragments only; the host retains bounded selection
and ambient transaction execution.

Generated discovery bridges necessarily name installed components. They are the
only permitted core references and regenerate with `npm run components:discover`
after source changes. References inside declared dependent component directories
are intentional. No core forwarding module is retained.

## Product and operator notes

EDLS manages sheets, crews, department tasks, supervisors and audit history.
`/edls/tos` lists workers on active Time Off Sick alongside upcoming assignments.
The summary dashboard intentionally retains its date controls when empty and is
gated by `edls` plus `edls.coordinator`. Operator scripts now live under
`components/edls/scripts/oneoffs/`; run them from the repository root and retain
their existing refusal/cleanup requirements. Do not run data-changing scripts
against a live deployment to verify extraction.

## Final boundary inventory

A case-insensitive filename and content sweep over existing tracked and
non-ignored source files found **zero handwritten core matches**, including
developer scripts, tests, product documentation and root agent guidance.
Feature-specific agent guidance moved with its owner, rather than being erased.
The matching source inventory contains 149 EDLS-owned text files and 91
intentional consumer files in these declared dependent directories:

- `components/sitespecific.freeman/`
- `components/sitespecific.freeman.edls_migrate/`
- `components/sitespecific.t631.client/`
- `components/worker.aat/`
- `components/worker.ratings/`
- `components/worker.tos/`

The only 11 matching core files are reproducible discovery bridges:

- `client/src/generated/component-contributions.ts`
- `scripts/migrate/generated-components.ts`
- `server/generated/component-metadata.ts`
- `server/generated/component-schemas.ts`
- `server/generated/component-server-modules.ts`
- `server/generated/component-startups.ts`
- `server/generated/component-storage.ts`
- `shared/generated/component-contributions.ts`
- `shared/generated/component-modules.ts`
- `shared/generated/component-schema.ts`
- `shared/generated/optional-components.ts`

Each starts with the generator's “do not edit” header. Run
`npm run components:discover` after adding/removing installed source.

## Verification

- Type checking and all 16 architectural lint rules passed.
- Existing feature and dependent-component tests passed, alongside reusable
  request-input, snapshot-authorization and browser-discovery contract tests.
- All 2,032 tests passed after reconciliation with the worker extraction.
  Previously failing record-go and card-check fixtures no longer fail on the
  merged checkout; no suite needs to be excluded.
- Disposable database checks exercised fresh bootstrap, actual prerequisite
  and EDLS enablement, enabled and retained-disabled full startup, and source
  removal with the complete declared reverse dependency closure removed,
  including the three worker integration owners.
- Source-absent production/browser builds and full production startup passed.
  A retained sheet, saved capture settings, historical snapshot, tables and
  component migration state remained unchanged.
- A legacy-column upgrade rehearsal ran the actual core provenance seed before
  creator-column retirement and verified that the sheet's creator survived.
- Browser-only fixtures exercised the real browser component registries and
  original dashboard/report-input lookup keys, and verified that nested sheet
  routes send the actual sheet ID to server-side authorization. Public invalid schedule links
  displayed the expected refusal, without changing authentication.
- The relocated notifier-root operator check rendered every shipped medium's
  defaults against an actual development sheet, without sending messages;
  all advertised fields were present and no token rendered unknown or empty.

Disposable databases were dropped and temporary verification copies were kept
outside version control. No production data or saved deployment settings were
changed for these checks.

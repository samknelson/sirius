# S1 migration ownership relocation manifest

## Status

Relocation implemented and verified on 2026-11-12. The destinations below
are the delivered owners. No live import, repair, destructive cleanup, cron
enablement, production data change, or deployment was performed.

The working tree was clean at implementation start; no unrelated working-tree
changes were overwritten. Verification used synthetic test records and
read-only HTTP/browser fixtures. Normal application startup created the
disabled singleton configuration through the existing configuration lifecycle.
No local help records were changed.

## Operations and direct consumers

All operation destinations are modules beneath
`server/plugins/system/oneoff/plugins/s1-migration/`. A single registered
`s1-migration` plugin owns them; its action list is empty. CLI callers import
individual operation modules, not the registration module or a core shim.

| Previous owner | Relocated methods | Updated direct consumers | Destination |
| --- | --- | --- | --- |
| `server/storage/entity-notes.ts` | `bulkDeleteForMigration`, `bulkReconcileForMigration`, `deleteForMigration`, `getMigrationNoteTargets`, `reconcileForMigration` | `scripts/s1-migration/load-log-notes.ts`; `tests/notes/bulk-reconcile-migration.test.ts` | `entity-notes.ts` |
| `server/storage/trust/elections.ts` | `createForMigration`, `updateForMigration` | `scripts/s1-migration/load-elections.ts` | `elections.ts` |
| `server/storage/trust/eligibility-exemptions.ts` | `deleteForS1AppealElection`, `listByS1AppealElectionNids`, `upsertForS1AppealElection` | `scripts/s1-migration/load-elections.ts` | `eligibility-exemptions.ts` |
| `server/storage/trust/wmb-events.ts` | `pageHistoricalWorkers`, `reconcileHistoricalWorker` | `scripts/oneoffs/backfill-wmb-events.ts`; mock target in `tests/s1-migration/wmb-event-phase.test.ts` | `wmb-events.ts` |
| `server/storage/users.ts` | `retireMigratedUserEmail` | `scripts/s1-migration/load-users.ts` | `users.ts` |
| `server/storage/ledger.ts` (payments factory) | `createForMigration`, `updateForMigration` | `scripts/s1-migration/load-payments.ts`; `scripts/s1-migration/lib/financial-link-repair.ts`; `tests/s1-migration/financial-link-storage-events.test.ts`; `tests/ledger/immutable-identity-postgres.test.ts`; mocks in `tests/s1-migration/financial-money-loaders.test.ts` and `tests/s1-migration/financial-link-repair.test.ts` | `payments.ts` |
| `server/storage/worker-hours.ts` | `bulkUpsertWorkerHoursMigration` | `scripts/s1-migration/load-hours.ts` | `worker-hours.ts` |
| `server/storage/workers.ts` | `createWorkerForMigration`, `updateWorkerForMigration` | `scripts/s1-migration/load-contacts-workers.ts`; create also in `scripts/s1-migration/load-relationships.ts` | `workers.ts` |
| `server/storage/workers.ts` | `getMigrationSiriusIdOwnershipSnapshot`, `applyMigrationSiriusIdOwnershipPlan` | snapshot: contacts/workers loader, relationships loader, `scripts/tools/s1-sirius-id-ownership.ts`, plugin `routes.ts`; apply: ownership CLI | `workers.ts`, `sirius-id-ownership.ts` |
| `server/storage/workers/relations.ts` | `reconcileFromMigration` | `scripts/s1-migration/load-relationships.ts`; `scripts/oneoffs/s1-relationship-endpoint-retarget-smoke.ts` | `relations.ts` |

`reconcileForMigration` has no current caller and was retained in the plugin.
Call-log communication reconciliation has been retired entirely. Approved
S1 logs use the worker-notes importer; there is no communication operation
to relocate or preserve.
The refreshed method-name search found no additional application consumer
outside the approved collisions route.

## Supporting ownership

| Previous location | Supporting code / consumer update |
| --- | --- |
| `server/storage/entity-notes.ts` | Moved `MigrationNoteTarget` and migration-only tag reconciliation SQL to plugin `entity-notes.ts`. Removed its re-export from `server/storage/index.ts`. Ordinary note display types, CRUD, orphan sweep, redaction, and ordinary note events stay in storage. |
| `server/storage/trust/elections.ts` | Moved `MigrationElectionInput` and migration-specific logging declarations to plugin `elections.ts`. Normal election validation and ordinary CRUD remain shared/core; dual-coverage rules were not moved. |
| `server/storage/trust/eligibility-exemptions.ts` | Moved `S1AppealElectionExemptionInput`, `S1AppealElectionExemptionResult`, and exclusive S1 ownership predicates to plugin `eligibility-exemptions.ts`. Shared exemption view/CRUD contracts are retained. |
| `server/storage/trust/wmb-events.ts` | Moved `EventChange` and `EventDecision` to plugin `wmb-events.ts`. `WorkerBenefitCoverage`, `WorkerScanResultRow`, `TrustWmbEventInput`, inferred-termination recognition, and normal denorm storage behavior remain shared. |
| `server/services/wmb-historical-inference.ts` | Moved unchanged into plugin `wmb-historical-inference.ts`; historical reconciliation, standalone backfill, and `tests/wmb/wmb-historical-backfill.test.ts` imports updated. |
| `server/storage/worker-hours.ts` | Moved `BulkMigrationHoursRow` and `BulkMigrationHoursPersistedRow` to plugin `worker-hours.ts` with the bounded bulk method. Normal hours operations and shared suppression infrastructure are retained. |
| `server/storage/workers/sirius-id-ownership.ts` | Moved snapshot, apply, sequence, and exclusive SQL helpers to plugin `sirius-id-ownership.ts`; ambient transaction behavior is retained. Updated direct snapshot import in `tests/s1-migration/sirius-id-ownership-snapshot.test.ts`. |
| `server/storage/workers/sirius-id-ownership-plan.ts` | Moved planner and types to plugin `sirius-id-ownership-plan.ts`. Updated contacts/workers loader, relationships loader, ownership CLI, ownership tests, dashboard projection, routes, and client type imports. |
| `server/modules/s1-migration-dashboard.ts` | Moved to plugin `dashboard-projection.ts`; updated `tests/s1-migration/sirius-id-ownership.test.ts`. |
| `server/storage/database.ts` | Migration methods disappeared through the narrowed factory interfaces; ordinary storage assembly and its logging wrappers are unchanged. |

## Wrapper and behavioral checkpoints

All 22 extracted method bodies were compared with their previous implementations
using TypeScript syntax nodes. They match exactly after normalizing relative
dynamic import paths and the WMB call to the retained shared coverage reader.
No migration method remains in core storage, its interfaces, or its exports.

- The logging middleware binds calls to the underlying implementation.
  Internal `this.*` calls are not equivalent to calls through a wrapped
  exported object. Preserve this distinction when sharing ordinary reads.
- Preserve explicit method logging declarations, getter resolution, host
  identity, effective actor, metadata maintenance, and sampling restrictions.
  Metadata still needs maintenance when audit rows are sampled out.
- Entity-note migration methods are absent from the ordinary note logging
  declaration. Do not assume ordinary note create/delete event behavior also
  runs for these migration methods.
- Election update has a dedicated migration logging declaration. Its old and
  new worker/date scopes must still emit after commit when they differ.
- Inactive-email retirement has a dedicated logging declaration and must
  retain its expected-value protection.
- Bulk hours is deliberately absent from ordinary hours logging. Its method
  requires both charge-plugin and notification suppression, rejects duplicate
  batch keys, and verifies every bounded chunk persisted fully. Keep
  loader-owned aggregate downstream effects at the loader boundary.
- Migration payment create/update intentionally omit ordinary currency
  cross-checks. The loader owns that preflight. Preserve historical input
  fields, shared validation and ledger identity constraints rather than
  replacing these operations with normal payment CRUD.
- Relation reconciliation uses shared validation, duplicate detection,
  old/new endpoint events, and role-history invalidation. Normal update
  forbids endpoint retargeting; do not weaken it to simplify extraction.
- WMB traversal unions coverage workers with relevant event-only workers.
  Do not replace it with active-worker traversal. Reconciliation preserves
  scan-confirmed terminations, inference provenance, cutoff and dry-run rules.
- Keep source Sirius-ID authority, relationship-shell semantics, and safe
  sequence advancement intact. Importing operation modules must perform no
  migration writes.

## Dashboard and host integration

Previous screen: `client/src/pages/config/s1-migration.tsx` (removed).
Delivered screen: `client/src/plugins/oneoff/s1-migration/dashboard.tsx`.
Delivered browser path: `/admin/oneoff/s1-migration`.
Old `/config/s1-migration` deep link redirects to the same host/view.
Navigation in `client/src/config/navigation-registry.ts` uses the new path.
`client/src/App.tsx` supplies the generic `/admin/oneoff/:pluginId` route.

Unchanged dedicated GET contracts, now owned by plugin `routes.ts`:

- `/api/s1-migration/status`
- `/api/s1-migration/collisions`
- `/api/s1-migration/runs`

`server/routes.ts` no longer imports or registers S1-specific routes.
`server/modules/system/oneoff.ts` registers plugin GETs with authentication,
admin and plugin/component checks. It resolves the supplied `configId` exactly,
or resolves a legacy request only if one configuration exists. Disabled,
wrong-plugin, missing/ambiguous and unavailable-plugin cases are refused.
Response bodies, redaction, absent-staging behavior, and in-flight ownership
coalescing are retained. Responses are private/no-store.

`server/plugins/system/oneoff/types.ts` declares separate dashboard and GET
registration extensions. `registry.ts` includes dashboard availability in its
manifest. `index.ts` loads the S1 plugin and applies the existing disabled
singleton default to all singleton Oneoff plugins, not just the example.
The ordinary singleton lifecycle seeds configuration, never importer work.

`client/src/pages/admin/oneoff-dashboard-registry.tsx` maps plugin IDs to lazy
dashboard components. The Oneoff page renders a separate dashboard instead of
action inputs, Execute, run monitor, or generic history. It does not poll
execution status for a dashboard. The server likewise does not reconcile stale
execution runs when a plugin with no actions receives a generic status read.
The S1 component keys each of its three requests by the exact configuration.

Updated built-in help:

- `system:s1-migration-monitoring` in
  `server/help/system/administration.ts`, matching `/config/s1-migration`
  and `/admin/oneoff/s1-migration`.
- `system:oneoff` in `server/help/system/oneoff.ts`, `/admin/oneoff`.

Matching, sanitization, read-only wording, built-in listing and fixture-local
coexistence were checked. Local database help was not edited or migrated.

## Entry points, packaging, and retained exceptions

Kept all existing loader filenames, `scripts/s1-migration/sync.ts`,
`scripts/s1-migration/lib/wmb-event-phase.ts`,
`scripts/tools/s1-sirius-id-ownership.ts`, and
`scripts/oneoffs/backfill-wmb-events.ts` callable with their current arguments.
The scheduled importer path is unchanged and was not enabled.

`Dockerfile` retains the source-inclusive migration image. Its file checks now
also assert plugin workers/WMB operations and the ownership CLI are packaged.
Its source COPY includes all operation modules. No container image was built
in this environment.

`tsconfig.scripts.json` now includes the standalone WMB backfill, ownership
CLI, and both affected smoke entrypoints. The ownership CLI's already-validated
approval hash now has an explicit non-null assertion for compilation; argument
validation and runtime behavior are unchanged.

Retain shared imported-coverage evidence reads, normal WMB denorm methods,
generic CRUD, ordinary ledger validation, employer-rate bulk CRUD,
Sirius-ID lookup, denorm batch invalidation, `invalidateWorkerScansBulk`, and
`setStorageLogSampling`. Freeman, core schema migrations, and generic boot
reconciliation are not part of this move.

## Shared helper and test adjustments

- Normal election validation, event emission and audit-description helpers stay
  in core and are shared by explicit exports. The election migration logging
  declaration and user retirement logging declaration live with their plugin
  operations and still use `withStorageLogging`.
- Relation validation, duplicate detection, event emission, sourced-WMB reads
  and role-history invalidation remain shared. Two factory-local helpers became
  shared top-level functions; ordinary methods are unchanged.
- Worker row redaction moved to the shared pure leaf
  `server/storage/workers/row-projection.ts` to avoid loading the entire workers
  factory during plugin registration. Both owners use the same projection.
- Existing source assertions and payment mocks now target plugin-owned payment
  operations. WMB test targets use the narrowed plugin operation interface.
- Existing `tests/s1-migration/ownership-preflight.test.ts` and
  `run-history-read-state.test.ts` import plugin-owned routes/UI.
- Existing Oneoff route/runner tests cover read gating, config identity,
  private/no-store responses, no execution side effects, and refusal of actions
  on an empty action list. Existing help tests cover the new exact path and
  near misses. No broad permanent browser or migration suite was added.

## Verification results and limitations

- App server/client typecheck passed.
- Vite production build and server esbuild bundles passed. The `npm run build`
  wrapper was deliberately not used because it runs `db:push` first.
- Storage-encapsulation architecture check passed.
- Final focused run passed **232 tests in 24 files**, covering notes,
  financial link/identity, ownership, WMB post-import, dashboard state, Oneoff,
  and help read-route boundaries. The command was:
  `npm test -- tests/s1-migration tests/oneoff tests/notes/bulk-reconcile-migration.test.ts tests/ledger/immutable-identity-postgres.test.ts tests/help/workflow-help-routes.test.ts --exclude '**/timezone-pin-structure.test.ts'`.
  The excluded known-failing suite was run separately and reproduced on the
  unchanged baseline, as detailed below.
- All ten operation modules imported successfully without invoking CLI modules.
  The ad-hoc CJS import harness logged an existing logger initialization warning;
  application startup itself initialized successfully.
- The unchanged standalone backfill entrypoint refused missing cutoff arguments;
  the unchanged ownership CLI refused `--apply` without an approval hash before
  reading/planning/applying ownership changes. Both exited 1 as expected.
- Application restarted and registered the plugin; its configuration seeded
  disabled. A direct unauthenticated status request returned 401. The preview
  screenshot showed the expected sign-in screen, not an authenticated dashboard.
- An ignored, one-time browser fixture rendered the actual Oneoff page,
  dashboard, Help dialog and help listing at desktop/mobile widths. It verified
  missing staging, failed history, disabled configuration, GET-only traffic,
  exact config IDs, built-in help and fixture-local help coexistence.
  A real signed-in application session was not verified.
- Existing WMB database tests exercised stored coverage and correction
  reconciliation; their final daily-summary assertion fails on missing financial
  identity fixture evidence, identically before this relocation.
- A detached unchanged baseline reproduced four existing failures across the
  timezone structure and historical-WMB suites: outdated writing-entrypoint
  inventory, old Docker stage-name assertion, duplicated zone literal, and
  missing daily-summary financial identity evidence.
- The existing full help coverage audit fails for
  `system:contact-field-configuration` at `/config/phone-numbers`; the unchanged
  baseline reproduces it. Targeted new help checks pass.
- Script compilation still reports the same 16 baseline errors: 12 references
  to retired `cronJobRuns` in the old write-fence smoke and four number/string
  Sirius-ID mismatches in the contacts/workers loader. The newly included
  ownership CLI type assertion was addressed. No migration business-rule fix
  was folded into this relocation. Normalizing diagnostic line numbers gives
  an exact before/after match for all 16 errors.

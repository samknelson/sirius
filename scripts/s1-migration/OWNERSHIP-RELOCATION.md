# S1 migration ownership relocation manifest

## Status

Inventory refreshed against the working tree on 2026-11-12. **Relocation has
not been implemented.** The destinations below are proposed ownership, not
claims about delivered code. No import, repair, cleanup, cron enablement, or
database mutation was run during this inventory.

The working tree was clean before this inventory. This document is the only
change made during the inventory.

## Operations and direct consumers

All proposed destinations are modules beneath
`server/plugins/system/oneoff/plugins/s1-migration/`. A single registered
`s1-migration` plugin should own them; they must not become HTTP actions.

| Current owner | Methods to relocate | Direct consumers found | Proposed destination |
| --- | --- | --- | --- |
| `server/storage/entity-notes.ts` | `bulkDeleteForMigration`, `bulkReconcileForMigration`, `deleteForMigration`, `getMigrationNoteTargets`, `reconcileForMigration` | `scripts/s1-migration/load-log-notes.ts`; `tests/notes/bulk-reconcile-migration.test.ts` | `entity-notes.ts` |
| `server/storage/trust/elections.ts` | `createForMigration`, `updateForMigration` | `scripts/s1-migration/load-elections.ts` | `elections.ts` |
| `server/storage/trust/eligibility-exemptions.ts` | `deleteForS1AppealElection`, `listByS1AppealElectionNids`, `upsertForS1AppealElection` | `scripts/s1-migration/load-elections.ts` | `eligibility-exemptions.ts` |
| `server/storage/trust/wmb-events.ts` | `pageHistoricalWorkers`, `reconcileHistoricalWorker` | `scripts/oneoffs/backfill-wmb-events.ts`; mock target in `tests/s1-migration/wmb-event-phase.test.ts` | `wmb-events.ts` |
| `server/storage/users.ts` | `retireMigratedUserEmail` | `scripts/s1-migration/load-users.ts` | `users.ts` |
| `server/storage/ledger.ts` (payments factory) | `createForMigration`, `updateForMigration` | `scripts/s1-migration/load-payments.ts`; `scripts/s1-migration/lib/financial-link-repair.ts`; `tests/s1-migration/financial-link-storage-events.test.ts`; `tests/ledger/immutable-identity-postgres.test.ts`; mocks in `tests/s1-migration/financial-money-loaders.test.ts` and `tests/s1-migration/financial-link-repair.test.ts` | `payments.ts` |
| `server/storage/worker-hours.ts` | `bulkUpsertWorkerHoursMigration` | `scripts/s1-migration/load-hours.ts` | `worker-hours.ts` |
| `server/storage/workers.ts` | `createWorkerForMigration`, `updateWorkerForMigration` | `scripts/s1-migration/load-contacts-workers.ts`; create also in `scripts/s1-migration/load-relationships.ts` | `workers.ts` |
| `server/storage/workers.ts` | `getMigrationSiriusIdOwnershipSnapshot`, `applyMigrationSiriusIdOwnershipPlan` | snapshot: contacts/workers loader, relationships loader, `scripts/tools/s1-sirius-id-ownership.ts`, `server/modules/s1-migration.ts`; apply: ownership CLI | `workers.ts` / ownership modules |
| `server/storage/workers/relations.ts` | `reconcileFromMigration` | `scripts/s1-migration/load-relationships.ts`; `scripts/oneoffs/s1-relationship-endpoint-retarget-smoke.ts` | `relations.ts` |
| `server/storage/comm.ts` | `updateInteractionWithCommForMigration` | `scripts/s1-migration/load-call-logs.ts`; direct factory call in `scripts/oneoffs/s1-sync-comms-statuses-smoke.ts` | `communications.ts` |

`reconcileForMigration` has no current caller and must still move.
`updateInteractionWithCommForMigration` still exists; it is not retired.
The refreshed method-name search found no additional application consumer
outside the approved collisions route.

## Supporting ownership

| Current location | Supporting code / consumer update |
| --- | --- |
| `server/storage/entity-notes.ts` | Move `MigrationNoteTarget` and migration-only tag reconciliation SQL. Remove its re-export from `server/storage/index.ts`. Keep ordinary note display types, CRUD, orphan sweep, redaction, and ordinary note events in storage. |
| `server/storage/trust/elections.ts` | Move `MigrationElectionInput` and migration-specific logging declarations. Normal election validation and ordinary CRUD remain shared/core; do not relocate dual-coverage rules. |
| `server/storage/trust/eligibility-exemptions.ts` | Move `S1AppealElectionExemptionInput`, `S1AppealElectionExemptionResult`, and exclusive S1 ownership predicates. Preserve shared exemption view/CRUD contracts. |
| `server/storage/trust/wmb-events.ts` | Move `EventChange` and `EventDecision`. Keep `WorkerBenefitCoverage`, `WorkerScanResultRow`, `TrustWmbEventInput`, inferred-termination recognition, and normal denorm storage behavior shared. |
| `server/services/wmb-historical-inference.ts` | Historical inference is consumed by the historical reconciliation, standalone backfill, and `tests/wmb/wmb-historical-backfill.test.ts`; include its ownership decision in the completed manifest. |
| `server/storage/worker-hours.ts` | Move `BulkMigrationHoursRow` and `BulkMigrationHoursPersistedRow` with the bounded bulk method. Keep normal hours operations and shared suppression infrastructure. |
| `server/storage/workers/sirius-id-ownership.ts` | Move snapshot, apply, sequence, and exclusive SQL helpers; retain ambient transaction behavior. Update direct snapshot import in `tests/s1-migration/sirius-id-ownership-snapshot.test.ts`. |
| `server/storage/workers/sirius-id-ownership-plan.ts` | Move planner and types. Update contacts/workers loader, relationships loader, ownership CLI, ownership tests, dashboard projection, routes, and client type imports. |
| `server/modules/s1-migration-dashboard.ts` | Move dashboard projection with ownership planner; update `tests/s1-migration/sirius-id-ownership.test.ts`. |
| `server/storage/database.ts` | Remove migration methods through the narrowed factory interfaces; inspect wrapper assembly rather than replacing logged calls with bare SQL. |

## Wrapper and behavioral checkpoints

These are relocation checkpoints, not completed equivalence verification.

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
- Communication reconciliation first proves both parent and child exist
  before writing either. Preserve the interaction-medium restriction and
  transaction boundary.
- WMB traversal unions coverage workers with relevant event-only workers.
  Do not replace it with active-worker traversal. Reconciliation preserves
  scan-confirmed terminations, inference provenance, cutoff and dry-run rules.
- Keep source Sirius-ID authority, relationship-shell semantics, and safe
  sequence advancement intact. Importing operation modules must perform no
  migration writes.

## Dashboard and host integration

Current screen: `client/src/pages/config/s1-migration.tsx`.
Current browser path: `/config/s1-migration`.
Current navigation owner: `client/src/config/navigation-registry.ts`.
Current lazy route owner: `client/src/App.tsx`.

Current dedicated GET contracts, all in `server/modules/s1-migration.ts`:

- `/api/s1-migration/status`
- `/api/s1-migration/collisions`
- `/api/s1-migration/runs`

`server/routes.ts` currently registers the S1 module independently of oneoff.
The completed move must remove that ownership and register the GET handlers
through a generic oneoff integration. Retain authenticated admin and
`sitespecific.bao.s1migration` gates, add unavailable/disabled plugin
refusals, and preserve redaction, absent-staging responses, and in-flight
ownership coalescing.

The existing oneoff interface exposes actions and a simple table status,
but has no dashboard extension. Add an explicit read-only dashboard
extension rather than treating reads as preflight/execution actions.
The plugin must have no migration mutation actions. The old browser link
must reach the same plugin-owned view, not a second screen.

Existing built-in help to update with the delivered behavior:

- `system:s1-migration-monitoring` in
  `server/help/system/administration.ts`, currently `/config/s1-migration`.
- `system:oneoff` in `server/help/system/oneoff.ts`, `/admin/oneoff`.

No local help records have been read or changed.

## Entry points, packaging, and retained exceptions

Keep all existing loader filenames, `scripts/s1-migration/sync.ts`,
`scripts/s1-migration/lib/wmb-event-phase.ts`,
`scripts/tools/s1-sirius-id-ownership.ts`, and
`scripts/oneoffs/backfill-wmb-events.ts` callable with their current arguments.
Preserve the scheduled importer path without enabling it.

`Dockerfile` has a migration image and explicit checks for the standalone
WMB backfill and post-import phase. Verify the new server plugin files are
included in that image. `tsconfig.scripts.json` is separate from app checks;
changed loader/tool imports need script compilation verification as well.

Retain shared imported-coverage evidence reads, normal WMB denorm methods,
generic CRUD, ordinary ledger validation, employer-rate bulk CRUD,
Sirius-ID lookup, denorm batch invalidation, `invalidateWorkerScansBulk`, and
`setStorageLogSampling`. Freeman, core schema migrations, and generic boot
reconciliation are not part of this move.

## Verification still required

No runtime or test-equivalence claim is made by this inventory.
Implementation, before/after method absence checks, focused existing tests,
script compilation, app checks, build, packaging verification, restart, and
authenticated dashboard/help and refusal checks remain outstanding.
The completed manifest must replace proposed destinations with actual paths
and record checks and limitations without presenting skipped checks as passed.

# Integration steps

## 1. Prepare without changing the application

Extract the archive **outside the receiving repository**, for example at
`/tmp/worker-comms-compliance-handoff`. Do not extract its source directory over
the application.

From the extracted package:

```sh
python3 tools/verify.py --patch-test
python3 tools/verify.py --target /path/to/receiving-repo
```

The second command only reports compatibility; a failed direct patch check is
expected when shared files have diverged. Inspect prerequisites before applying.
The checks cannot prove API or schema compatibility merely because a file exists.

In the receiving repository, confirm a clean working tree, create a branch,
and preserve a checkpoint/commit for recovery:

```sh
git status --short
git switch -c integrate/worker-comms-compliance
git apply --check /absolute/path/to/package/feature.patch
```

If the direct check succeeds:

```sh
git apply --index /absolute/path/to/package/feature.patch
```

If it fails because shared files differ, do **not** copy full snapshots over them.
Read the diff and prepare three-way resolution:

```sh
# Check first; without --write this does not import anything.
python3 /absolute/path/to/package/tools/seed_merge_bases.py --target .
# Explicitly writes only the package's verified old blobs into .git/objects:
python3 /absolute/path/to/package/tools/seed_merge_bases.py --target . --write
git apply --3way --index /absolute/path/to/package/feature.patch
```

A three-way apply can leave conflicts and staged changes. Stop and resolve them
before running the application. Preserve both the feature and target-specific
behavior. Inspect `git status`, `git diff --cached`, and `git diff --check`.
If the component is already partly present, use the patch and base/source pairs
to integrate only missing changes; do not force duplicate registrations.

## 2. Review the nine shared integration points

The manifest classifies each file as `new` or `shared`. New files can also have
name collisions in an expanded application; review those rather than overwriting.

| Shared file | Required change; preserve everything else |
| --- | --- |
| `shared/components.ts` | Add disabled-by-default `worker.comms_compliance` component. |
| `server/storage/workers.ts` | Export the existing population predicate and search-parameter type, add multi-select benefit/status support and optional monthly bounds. Keep the target's additional filters and ordinary worker-list behavior. |
| `server/storage/database.ts` | Import storage factory/type, add interface/class member, instantiate once. Adapt to an equivalent storage composition if the target differs. |
| `server/routes.ts` | Register the component's routes once with existing authentication middleware. |
| `server/plugins/dashboard/index.ts` | Import the plugin once. |
| `server/plugins/menu/plugins/default.ts` | Add staff+component-gated Workers menu item. |
| `client/src/App.tsx` | Lazy import and protected literal route before any matching dynamic worker route. |
| `client/src/components/bulk/list-bulk-action.tsx` | Forward optional `{definitionId, view}` reportSelection on both new and existing message requests. Other callers must remain unchanged. |
| `server/modules/bulk/messages.ts` | Revalidate report membership on `/api/bulk-messages/from-recipients` before creating/enqueueing recipients; resolve the effective (masqueraded) actor; preserve WorkerCommsError statuses. |

The new files contain the shared definition schema/resolver, report storage,
service/route layer, editor, report page, server/client dashboard plugins, and
five test files.

## 3. Check compatibility contracts

- Path aliases: `@shared/*` points to `shared/*`; `@/*` to `client/src/*`.
- Existing libraries: React, React DOM, TanStack Query, Wouter, Lucide, Zod,
  Drizzle, Express, Vitest, and the existing UI primitives. The manifest records
  source versions as a reference, **not** a command to downgrade/replace the
  target lockfile. No new library is required in the source project.
- Existing auth/policies: staff reads, admin definition changes, `bulk.edit` plus
  enabled bulk component for bulk handoff. Reuse the target evaluator and
  masquerade/effective-actor semantics; do not bypass its permission system.
- Storage: transaction-context `getClient()`, variables getByNamePrefix/getByName/
  create/update/delete, component cache, workers/contact search helpers, and
  the `IStorage` composition. Preserve existing logging/provenance wrappers.
- Database: `workers`, `contacts`, `comm`, `comm_tags`, `options_comm_tags`,
  `options_worker_ms`, `employers`, `options_employer_type`, and current worker
  employment/contact filter tables. Review actual SQL and the target schema.
  `trust_wmb`/`trust_benefits`, `bargaining_units`, and
  `sitespecific_btu_political_officials` are conditional on their components.
  Match column/type meanings, not just table names. `trust_wmb` uses year/month.
- The existing Bulk UI and `/api/bulk-messages/from-recipients` endpoint must
  already support new-message creation and adding to an existing message.
  This patch adds report selection checking; it does not recreate bulk delivery,
  existing-message search, recipient resolution, postal export, or comm logging.
- The client dashboard registry must recognize
  `worker-comms-compliance:WorkerCommsCompliance`; keep its existing directory/
  filename discovery convention. The server plugin must expose the same key.
- `reference/` contains small pre-existing helpers for comparison. It is not a
  full transitive dependency vendor directory. The manifest lists direct local
  imports made by feature files and shared bulk UI, allowing missing prerequisites
  to be identified without replacing the receiving app's frameworks.
- Use the target's existing site/process timezone initialization. Calendar-month
  windows are server-resolved, not browser-timezone calculations.

## 4. Verify before enabling or publishing

Use the receiving application's commands where names differ:

```sh
npx vitest run tests/comm/worker-comms-compliance*.test.* tests/comm/worker-comms-benefit-history-db.test.ts
npm run check
npm run lint
# Only if present; substitute the receiving app's appropriate comparison base:
npx tsx scripts/check-migrations.ts --base=origin/main
git diff --check
```

The SQL integration test requires a **development** database and uses
transaction-local temporary tables plus rollback. It skips when DATABASE_URL is
unavailable or NODE_ENV is production. A skipped test is not a passing database
compatibility check. Do not point it at production or bypass its guard.

No schema migration is needed **on a compatible baseline**: definitions use the
existing variables table. If required infrastructure is missing, assess it
separately. Do not copy unrelated migrations or run blind schema pushes.

Restart the target's existing workflow. Enable the component through its admin
configuration and smoke-test signed in:

1. Admin creates, edits, deletes a definition; staff can read but cannot edit.
   Disabling the component blocks API, route, menu, and dashboard access.
2. Compare current, ever, last one/six months, and a past-year date range.
   Include future-only history and multi-benefit/status populations.
3. With+without counts equal population; report and dashboard windows agree;
   communication sent dates change evidence, not benefit membership.
4. Select rows/all matches and queue to **both** new and existing draft messages.
   Confirm the intended recipients and rejection of stale/out-of-cohort IDs.
   Do not send messages as part of a smoke test.
5. Unavailable saved benefits/options fail closed, rather than widening the
   recipient population.

Finish a dedicated integration commit with the source and base commit IDs from
manifest.json, target-specific conflict decisions, verification outcomes, and any
missing prerequisites. Keep the package manifest for subsequent delta updates.

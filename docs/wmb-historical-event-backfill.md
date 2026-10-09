# Historical WMB lifecycle event backfill

## Common importer phase

`scripts/s1-migration/sync.ts` invokes the same reconciler through
`lib/wmb-event-phase.ts` after the complete loader fleet and parity gates,
before the aggregate run is stored or the advisory lock/write fence released.
Manual and scheduled runs share this path. Counts are separate under
`wmbEvents` in the aggregate report and `s1_staging.runs`, and scheduled SNS
completion/failure summaries include the same aggregate phase fields:
status/reason, mode/basis, inclusive cutoff, duration, pages/workers, totals,
event-type totals, and candidate-traversal completeness. The explicit policy is
`accepted-import-stored-coverage`; `sourceHistory` retains only the pinned cutoff,
staged/processed/rejected span counts, verification failures, and the original
source completeness flag. No worker samples or raw exceptions are
forwarded into the phase report or alerts.

The phase keyset-pages **all workers**, not merely the one-off's default first
500. It checks page and worker results, cursor advancement and aggregate
counter agreement. Worker failures, malformed results, exceptions, stalled
cursors or the 100,000-page safety bound fail the overall sync. A partial
failure may have committed earlier worker transactions; rerun the full
command from the beginning after fixing the cause. Do not resume from the
last successful cursor after a worker failure.

The cutoff is the coverage loader's **actual pinned horizon**. The
orchestrator pins this once even when a run crosses a month boundary. The
loader supplies evidence: nonempty staging, every staged span visited, valid
aggregate rejected-span counts, and zero verification failures.
A completed stage and successful whole-fleet/parity gates are also
required. `--skip-stage` has no fresh stage proof and therefore cannot run an
enabled live event phase. Missing/malformed evidence or a mismatched/invalid
cutoff refuses with `unsafe-or-missing-stored-coverage-evidence`.

**Deliberate policy relaxation:** importer-approved rejects no longer block the
event phase. The importer and its existing reviewed allowlist remain authoritative;
disallowed rejects, failed staging/import/parity, incomplete span traversal,
verification failures and worker reconciliation failures still prevent success.
For example, accepted evidence with 646,623 staged/processed spans, 82,854
reviewed rejects, zero verification failures and the pinned `2026-10` horizon
now authorizes reconciliation. No source category allowances are added.

Events describe coverage **actually stored in S2**, including retained scratch
outcomes; they do not certify completeness of rejected S1 histories or claim
those histories are harmless. The existing loader
`historicalEventEvidence.complete` remains **false** when spans were rejected,
and that value stays false in `wmbEvents.sourceHistory.complete`. A passing phase's
`wmbEvents.complete: true` means all stored-coverage candidates were traversed
successfully, not that all source spans were imported. There is no per-history
reject exclusion or attribution mechanism.

Dry-run imports **skip** the event phase and explicitly report preview mode,
`basis: stored-coverage`, and `dry-run-no-verified-stored-history-cutoff`.
They never infer from uncommitted importer previews. For an independent
stored-coverage preview, use the one-off below with an independently verified
stored-coverage cutoff; it is not a prediction of hypothetical import
changes.

No application cron configuration is changed, no scans or general denorm
backfills are invoked, and the event phase writes only lifecycle events via
the existing historical reconciler. Storage side effects are drained before
the parent releases serialization and closes its connection pool.

## Activation and required proof

Production's checked-in `historicalWmbEvents` switch is **true**; this change
does not alter that existing switch. A checked-in switch is not proof that a
remote schedule uses this revision. Both profiles accept importer-reviewed
rejects under the stored-coverage policy; disabled and dry-run behavior remain
unchanged. Local fixtures and dev smokes are not remote deployment evidence.

Before updating the production schedule target:

1. Rebuild the **migration** Docker image containing this policy change and
   pin its immutable digest in a new ECS task-definition revision. An old image
   or task definition still executes the old zero-reject gate.
   Run the actual common fleet on the designated test target with verified
   staging and importer-accepted coverage, using that candidate migration
   image. Include reviewed rejects and confirm their aggregate counts remain
   visible with source completeness false. Record target identity, image digest, source revision, task
   definition ARN/revision and inclusive cutoff. Keep application crons
   suppressed throughout. Use no production secret values in evidence.
2. Capture `trust_wmb_events` grouped by type/provenance before import and
   after it. Verify first-uncovered-month inferred endings, runs reaching
   the cutoff staying open, empty `failedPlugins`, and unchanged confirmed
   scan event data. Retain redacted representative month/provenance evidence.
3. Rerun the same accepted import. Record coverage-import duration and event
   phase duration **separately** for initial and repeat runs. Confirm zero
   new duplicate events and no unexplained event changes.
4. Correct a test source gap, run the fleet again, and prove the obsolete
   inferred ending disappears while scan-confirmed endings survive. Compare
   coverage, scan queue, eligibility, billing and notification snapshots
   immediately around the **event phase**, not around the whole import.
   Verify enabled application cron count remains zero.
5. Review the evidence and update the existing Scheduler target's
   `EcsParameters.TaskDefinitionArn` to the tested new task-definition revision.
   Inspect the schedule and task definition to prove the exact ARN/revision and
   immutable image digest match the tested candidate. Keep the scheduled wrapper
   command, timing, rejection allowances and global/application cron suppression
   unchanged. If any deployment revision changes the image, repeat the test proof
   against the final digest before switching the production target.

The migration Docker target already includes the source tree and now asserts
the reconciler and runner are packaged. No full web development dependencies
or additional recurring job are required.

**Deployment evidence boundary:** this local implementation does not execute
production imports, publish a migration image, register a remote task definition
or change an AWS schedule. Remote fleet execution and Scheduler target success
are not claimed without actual execution evidence from an authorized operator.

### Local policy verification — 2026-10-09

Targeted WMB phase, daily reporting, fleet-gate and historical database suites
passed (23 tests). Type checks and architecture lint passed. The real local
storage reconciler was exercised with supplied aggregate evidence (646,623
staged/processed spans, 82,854 reviewed rejects, zero verification failures)
and the exact `2026-10` horizon over synthetic coverage fixture rows.
The fixture produced a passing scheduled summary with source completeness false,
converged on rerun, and removed an obsolete inferred ending after filling a gap.
Existing scan-event precedence tests also passed. These are supplied evidence
counts, **not** a local staging/import of 646,623 source spans. Importer tests
exercise existing allowed categories and disallowed categories without inventing
a production category breakdown. No remote fleet, migration image, task definition
or Scheduler update was executed.

### Historical local verification record — 2026-10-07 (prior zero-reject policy)

Target: workspace PostgreSQL `helium/heliumdb`, not the designated remote
test target. Execution: workspace TypeScript/Vitest, **no migration container
image or ECS task revision was executed**. The fixture phase used the real
storage reconciler through the integrated runner, scoped to synthetic fixture
benefit data (not a full S1 fleet run).

Cutoff: `2034-03` inclusive. Page size 1 traversed 2 workers in 2 pages:

| Phase | Created | Unchanged | Removed | Skipped | Failed | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Initial event phase | 5 | 2 | 0 | 0 | 0 | <0.05s (reported 0.0s) |
| Identical rerun | 0 | 7 | 0 | 0 | 0 | <0.05s (reported 0.0s) |
| Fill source coverage gap | 0 | 5 | 2 | 0 | 0 | Not captured separately |

Representative persisted evidence: a synthetic worker covered in January and
March 2034 had zero endings before, one inferred February ending after, and
the exact same row after rerun. Its data was
`{"provenance":"coverage_inferred","failedPlugins":[]}`. Filling February
coverage removed that inferred ending and the obsolete March restart.
The March cutoff run remained open. A confirmed February 2031 scan event on
the other fixture worker retained its original failure data. The scan queue,
coverage rows and cron configuration were unchanged by the event phase.

Four targeted suites passed (21 tests). The application started and its
public sign-in page rendered. Local cron policy was already enabled; these
checks prove **no phase-driven change**, not suppression in the remote test
environment. No coverage-import duration, remote target/image proof, final
deployment digest, or production Scheduler revision proof is available yet.
This record must not be used to authorize production activation.

This is an event-only tool. It does not scan eligibility, create coverage, queue
jobs, open COBRA cases, or notify anyone. Run on a database backup/rehearsal
first. Choose `--cutoff=YYYY-MM` as the **last month whose coverage history is
accepted for stored-coverage interpretation**. A run ending in that month stays open. The first missing month
following an earlier covered month is an *inferred* ending, not a failed scan.
Never choose a cutoff beyond the verified, accepted stored-coverage import horizon.
The standalone CLI is unchanged; it does not validate fleet evidence for you.

Preview (default, read-only):

```sh
npx tsx scripts/oneoffs/backfill-wmb-events.ts --cutoff=2025-12 --limit=500
```

Inspect `byTypeBenefitMonth` for counts and up to three worker samples per
group. `created` in preview means *would create*; `removed` means *would
remove*. Starts and restarts follow existing denorm semantics: the first
covered month is both a start and a restart; each later coverage run has a
restart. The tool reconciles starts/restarts inside the cutoff using the same
coverage definitions as the denorm plugins. It never removes scan-confirmed
terminations or events outside the cutoff.

To verify a smaller slice, pass `--worker=ID` and/or `--benefit=ID`. After
checking the preview, add `--live` to write. Each worker is reconciled in a
transaction. A run processes at most `--limit` workers (default 500), returns
`nextAfterWorker` if more remain, and exits 2 when incomplete or any worker
failed. Continue with the **same cutoff and scope**, adding
`--after-worker=ID` using that cursor; only an exit 0 means the traversal
finished. After fixing a failure, rerun from before the failed worker or from
the beginning. Re-running is safe. If source coverage changes, rerun from the
beginning to remove obsolete inferred terminations, including workers whose
last coverage row was removed.

`created`, `unchanged`, `removed`, `skipped` (a scan event owns the key), and
`failed` are reported; group samples are bounded. Inferred terminations carry
`data.provenance = "coverage_inferred"` and an empty `failedPlugins` array.
Confirmed scan terminations take precedence; the COBRA reconciler ignores
inferred events. Inferred events remain visible to historical event queries.

Read-only validation queries (adjust month and benefit as appropriate):

```sql
SELECT event_type, benefit_id, year, month,
       data->>'provenance' AS provenance, count(*)
FROM trust_wmb_events
WHERE year <= 2025
GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4;

SELECT worker_id, benefit_id, year, month, data
FROM trust_wmb_events
WHERE event_type = 'terminate' AND data->>'provenance' = 'coverage_inferred'
ORDER BY worker_id, benefit_id, year, month LIMIT 100;
```
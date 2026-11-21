# Coverage readiness investigation

## Open incident: staging evidence on 2026-11-21

**Unresolved. No staging recovery is established.** The operator's latest
reported check finished at **08:46:23 on 2026-11-21**, with 119,941 people,
zero missing initial records, 113 stale/processing coverage-span rows and zero
failed rows. Its timezone and selected configuration/run identity were not
provided. Earlier counts of 255, 202 and zero do not establish convergence or
identify a producer.

Authorized GitHub read-only observations around **16:51 UTC** established:

| Evidence | Result |
| --- | --- |
| `bao-stg` branch tip | `552d7e57398ece4f0e2e90bbd6430d53691e09bf`, matching the workspace HEAD |
| GitHub deployment `7966195634`, environment `Staging` | Same revision; created **16:36:13 UTC**, reported successful **16:41:44 UTC** |
| Previous staging deployment `7965721815` | `965123fd101c7cdef649b2b25b6aad8d7f8a69b3`; successful **16:03:41 UTC**, marked inactive **16:41:44 UTC** |

The successful deployment status points to the
[Flightcontrol staging deployment](https://app.flightcontrol.dev/org/cmkcpells0069h33qzcdocwlr/environments/cmsoy2hmz000nlnmja06p7r7q/deployments/cmwqmqpdj075228mw486sb789).
These are deployment-controller records, **not** a read of the serving API
process or its database. GitHub supplied no application environment URL.
The initial query using environment `bao-stg` returned no deployments; the
actual GitHub environment is `Staging`. A branch tip or an empty result for
the wrong environment must not be treated as runtime deployment proof.

If the operator's timestamp is Pacific standard time (UTC−08:00), that check
finished at **16:46:23 UTC**, after the newer deployment reported success.
This is conditional, not a confirmed correlation. Do not prescribe deploying
the same revision again as a diagnosis.

### Access blocker and next evidence

The managed production SQL read refused with “This project has no production
database.” Replit deployment metadata also reported no Replit deployment;
neither result describes the external Flightcontrol database. No connected
Flightcontrol, AWS or PostgreSQL integration was available. Existence-only
checks found no `BAO_STG_DATABASE_URL`, `STAGING_DATABASE_URL`,
`AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` secret in this workspace.
No secret values were read. No authorized staging operator session was
available.

Consequently the running API revision, diagnostic table/schema, enabled
configurations, claims, operation-counter deltas and current readiness remain
unverified. There is no evidence yet classifying the 113 rows as finite work,
starvation, legitimate mutations, redundant invalidation or a feedback loop.
The source trace and prior synthetic results below are not that evidence.

To resume, an authorized operator must supply an approved read-only staging
access path, or collect a non-personal evidence bundle using their existing
access:

1. Confirm the operator check's timezone, EDI configuration ID, wizard/run ID
   and start/finish times. Confirm the serving API image revision and startup
   migration/drift result from the linked staging deployment, not the branch.
2. Confirm `coverage_readiness_work` exists with the columns used by
   `scripts/tools/coverage-readiness-snapshot.sql` before running its aggregate
   query. Absence means diagnostics are unavailable, not zero producer work.
3. Capture the existing repeatable-read snapshot for both required denorm
   configurations, then another across an **already scheduled** producer/drain
   cycle. Include the selected configuration IDs and effective enabled state,
   relevant scan/drain cron settings and bounded maintenance run times/results.
   Compare counters only within the same configuration, deployed/schema
   baseline and interval. Do not attach names, worker IDs, scan summaries,
   credentials, cookies or raw request/response payloads.
4. Use those observations to choose a correction or propose a specific
   maintenance action for separate authorization. Do not clear status rows,
   change schedules, run eligibility scans or launch a rebuild to collect
   evidence. After correction and any authorized maintenance, capture a fresh
   **coverage check only**, without generating or delivering a carrier file,
   and observe the next relevant producer/drain cycle.

Only this investigation record changed in this incident pass; no application
defect was inferred or patched without staging evidence. No staging mutation,
deployment, scan, rebuild, cron change or carrier action was performed.
Existing in-app denorm/EDI help still accurately distinguishes missing
backfill from stale recomputation, preserves strict readiness, and warns
against clearing coverage or running eligibility scans as a refresh. No
product behavior or recovery action changed, so no help update or new
regression fixture is warranted yet. The signed-in UI and staging recovery
have not been verified.

## Evidence and limits

On 2026-11-21 the workspace's managed production read refused because this
project has no managed production database. No authorized external production
connection or signed-in operator session was available. The reported population
of 119,941, repeated 24 and zero → 202 transition therefore **cannot be
attributed conclusively** to a live producer from this workspace.

Read-only development observations at 01:09:52 and 01:10:47 UTC found 150 OK,
zero stale and zero errors for both enabled configurations:

- Worker benefit coverage spans: `a102b800-8403-4104-bc69-e78cafdaa805`.
- Trust WMB Terminate Events: `33980444-2856-434a-b6a3-835df505e20a`.

The worker-population join also returned 150, missing zero, OK 150, stale zero,
failed zero for each configuration. Span generations were all 1; upstream
termination generations ranged from 1 to 237. Those generation counts alone
do not identify an invalidating producer. The sole development EDI wizard had
no saved coverage-check status or observation timestamp. This is development
evidence, not verification of the reported environment.

The supplied repeatable-read snapshot was also executed successfully at
01:13:27 UTC: admin and EDI counts agreed in the same snapshot for both
configurations. The development scan queue contained 52 pending jobs across
worker-update, ledger-entry and COBRA-case triggers, with no processing or
recently completed jobs returned. Pending jobs are potential future source
work, not evidence that they caused the reported remote stale counts.

## Producer trace

- **Termination recomputation:** `trustWmbTerminate` rebuilds from persisted
  scan summaries and current granted coverage. Its write passes the full desired
  set to `trustWmbEvents.replaceForWorkerAndType`. Previously every invocation
  invalidated spans *before comparing events*, including empty → empty and
  unchanged inferred rows. A bounded upstream backfill/drain can therefore make
  an already-zero downstream population stale again, even when no ending
  changed. This is a proven redundant producer, not proof of the live 202.
  The repair invalidates only when a delete, insert or JSONB data change actually
  occurs, in the same transaction. JSON object-key ordering is immaterial.
  Inferred events survive absence from scan output; confirmed collisions still
  replace their authority and invalidate the worker and family receivers.
- **Scan completion and reset:** completion hands off `trust-wmb-terminate`
  seeds atomically with persisted results. It no longer blindly invalidates
  every recipient's span on every completion. A changed confirmed termination
  invalidates spans from the event replacement transaction, after semantic
  comparison. Completion still invalidates a span when the scan's new status
  or summary can change a retained coverage-inferred ending; those endings are
  the case where span computation directly consumes scan-summary availability.
  Monthly requeue, single enqueue and single/bulk reset capture retained
  `people`/`actions` recipients under lock before removing or hiding summaries.
  Those transitions remain invalidating because the prior result is no longer
  available to the span reader. These are necessary source/evidence changes,
  not removed. A continuing scan queue can keep producing genuine work.
- **Migration event reconciliation:** the historical reconciler enqueues spans
  only for actual created/removed decisions, preserves confirmed events, and does
  not enqueue in dry-run mode. It is a finite producer when its source traversal
  is finite, not a timer-triggered self-invalidation loop.
- **Coverage/family writes:** coverage creates/deletes and relationship/cascade
  changes go through the shared role-history invalidation helper, which includes
  spans. These preserve affected prior/current recipients. Real source writes
  remain authoritative even if an operator previously saw zero stale.
- **Employer classification:** patches carrying `siriusId` invalidate covered
  workers and families, including same-value patches. There is no evidence here
  of a recurring producer issuing these patches. This conservative invalidation
  remains intact; do not suppress it based on the reported count.
- **Configuration changes:** coverage-span config changes mark existing status
  rows stale through `invalidateOnConfigChange`. Missing-only backfill uses an
  anti-join and does not continually requeue already tracked workers.
- **No self-loop established:** span replacement writes its own payload, not
  upstream termination sources. Termination replacement does not schedule itself.
  Repeated no-op upstream recomputes caused redundant downstream work, but this
  alone is not an infinite loop. If stale work recurs after all upstream work
  stops, capture source operations rather than assuming another backfill.

## Read and retry trace

Admin status groups saved denorm rows by config. EDI joins all workers to the
one selected enabled config per required producer, including missing rows;
ending-enabled checks additionally require the termination producer. Both read
the application database. The read-only facade starts a read-only transaction,
not a replica connection. Generation/claim fencing and final revision checks
remain unchanged.

Admin detail inherited infinite query freshness with no polling; returning
could show an old zero. It now refreshes on mount/focus or **Refresh counts**,
labels the refresh time and prevents HTTP caching. No interval was added.
Historical wizard errors remain stored until a new check is admitted.
The existing safe-retry admission already permits failed/completed coverage
checks and refuses active/unrecognized states; isolated PostgreSQL verifies
this rather than changing the safety predicate. The client now replaces the
old failure display immediately on confirmed admission. New failures record a
finish time; older failures use start time or explicitly report no timestamp.
Each new run has a new identity and review-query key, reads readiness again,
and cannot accept a late result from an earlier attempt.

## Read-only operator correlation

`scripts/tools/coverage-readiness-snapshot.sql` captures matching counts,
generation/time ranges, queue activity, bounded producer aggregates and saved
check timestamps in one repeatable-read transaction without source payloads or
personal details.
Capture once at zero and once after recurrence, noting which configuration
the operator opened. Compare upstream draining/computation times with new
span stale times and existing job history. A shrinking upstream backlog that
eventually stops producing changes is finite catch-up. Continuing source
mutations legitimately requeue work. Identical termination replacements no
longer advance span generations, and ordinary scan completions no longer add a
second blanket span invalidation after the termination producer is scheduled.

`coverage_readiness_work` keeps one aggregate row per denorm configuration and
fixed operation category. It records cumulative call/affected-row counts and
the last call's count/time; it does not retain worker IDs, eligibility payloads,
or an unbounded event history. Scan-completion handoffs to the upstream
termination configuration are recorded separately from span invalidations.
The snapshot query reads these aggregates alongside status generations and queue
activity. This makes future recurrence attributable to a configuration and
operation category, but cannot retrospectively identify the cause of the
reported 255 without an authorized before/after read in that environment.

## Verification scope

Focused isolated PostgreSQL fixtures exercise unchanged and empty replacements,
changed authority, family invalidation, rollback, finite catch-up and convergence,
strict readiness, and failed check → completed recomputation → explicit retry
with a new identity and late-write fencing. Synthetic fixtures are not a
production recovery claim.

All 117 checks in the focused batch passed, with 5 skipped across six test
files. This includes `coverage-spans-postgres.test.ts`,
`coverage-evidence.test.ts`, WMB queue storage and built-in help. The batch
covers the inferred-evidence-only scan handoff, avoids a duplicate span
invalidation when a scan will replace an inferred event, and verifies that a
plain scan does not stale an unrelated span. TypeScript server/client checks
also passed. One-time server rendering verified failed,
in-progress and completed coverage screen states, including the failure time
and absence of obsolete failure text outside the failed state. Help recovery
copy survived the shared sanitizer, and intended paths plus unrelated near
misses were checked. These are source/render checks, not an authenticated
browser session or an opened Help dialog.

The application restarted successfully and passed its startup schema drift
gate. The browser capture of the admin detail route reached the expected
sign-in screen; authentication was not bypassed. The signed-in admin refresh
control, actual coverage retry click and Help dialog remain unverified in a
real operator browser.

No application coverage was cleared, statuses forced to OK, eligibility scans
run, full rebuilds started, or carrier files generated/delivered. Signed-in UI
and real-environment recovery cannot be verified without authorized access.
Help was updated in the existing built-in denorm and EDI wizard guidance; no
local help records were changed.

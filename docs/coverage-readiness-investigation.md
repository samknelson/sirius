# Coverage readiness investigation

## Open incident: staging evidence on 2026-11-21

### Operator-supplied database snapshot at 16:54 UTC

This later evidence supersedes the initial access-blocked observations below,
but **does not establish recovery**. The operator supplied the read-only
snapshot at **2026-11-21 16:54:36.925999+00** and schema preflight at
**16:55:07.430331+00**. Database timezone was `GMT`;
`coverage_readiness_work` existed with all seven expected diagnostic columns.
This confirms the attribution schema, not the entire application schema or
the revision of each serving API process.

The saved-check result identifies EDI configuration
`9748ccb0-e88b-4c8c-9027-672f478b8c0f`, check started
**16:46:20.264 UTC** and failed **16:46:23.042 UTC**. That matches the reported
08:46:23 finish in UTC−08:00 and occurred after the deployment controller's
16:41:44 success. A second saved record with the same start time remained
`in_progress`; the aggregate query does not expose wizard IDs or execution
ownership, so it cannot establish whether this is duplicate work, an abandoned
record or a distinct saved wizard. Do not reset it on that evidence.

| Producer/configuration | Whole-worker readiness at 16:54:36 UTC |
| --- | --- |
| Spans `0406b4a3-d991-452f-9b50-d475edc7caaf` (enabled) | 119,941 population, 119,914 OK, 27 stale, zero missing or failed; admin and EDI counts agreed |
| Termination `b0672afc-76ed-42d9-900e-c7c6fc7ac595` (enabled) | 119,941 OK, zero missing, stale or failed; admin and EDI counts agreed |

All 27 stale span rows were **unclaimed**, with stale timestamps from
**16:50:53.585 through 16:54:35.672**. The newest successful span computation
was **16:51:01.095**. Thus this snapshot shows recently queued work while
computation has also advanced; it does not show old abandoned span claims.
It cannot prove that the original 113 workers drained, since the same worker
can be invalidated again and individual identities were intentionally omitted.

The cumulative attribution baseline is:

| Configuration | Operation | Calls | Affected invalidations | Last operation timestamp |
| --- | --- | ---: | ---: | --- |
| Termination | `wmb_scan_completion_handoff` | 287 | 341 | 16:54:36.743 |
| Spans | `role_history_source_change` | 63 | 191 | 16:54:35.677 |
| Spans | `scan_worker_requeue` | 3 | 4 | 16:46:36.834 |
| Spans | `termination_evidence_change` | 10 | 11 | 16:52:09.706 |

Affected counts are invalidation operations, not distinct people or the current
stale count; the counter's installation/reset baseline was not supplied.
In source, `role_history_source_change` is the shared WMB/relationship/cascade
source-write boundary. `termination_evidence_change` is recorded only when
termination event replacement inserts, deletes or changes JSONB evidence.
The counters therefore distinguish actual recorded source-boundary work from
blanket scan-completion span invalidation, but do not attribute all 27 rows
to a particular scan or prove every source change was necessary.

There was concurrent scan activity: **54,239 pending monthly-batch jobs**,
**14 processing**, **1,475 monthly-batch successes in the preceding hour**,
and **9 monthly-batch failures** in that hour. The oldest processing pick was
**2026-11-20 01:18:19.633**, the newest **2026-11-21 16:54:36.828**.
COBRA-triggered results also included 9 successes and 11 failures in the
preceding hour. Scan failures are a separate queue result, not the zero
denorm-error count. The very old processing pick warrants checking execution
ownership; it does not prove the entire queue is blocked while other jobs
continue completing.

The source's span drain is bounded to 5,000 rows per plugin per sweep and is
subscribed to the shared ten-minute tick, alongside the separately configured
`denorm_stale` cron and admin action. New source writes can therefore leave
recent unclaimed spans between drain runs. This is a demonstrated mechanism
consistent with this snapshot, **not yet proof of the live tick's execution or
eventual convergence**. A second contemporaneous snapshot plus effective cron
settings/history is needed to distinguish sustained source production from a
missed/blocked drain. No additional application correction or staging mutation
is justified from this one snapshot alone.

**Next evidence:** repeat the same snapshot after a scheduled drain boundary,
capture the effective denorm/scan cron switches and schedules and their recent
run results, and confirm API runtime/boot identity. Attribute the counter
deltas before authorizing any maintenance, and retain a fresh successful
coverage check plus a subsequent producer/drain observation as the recovery
criterion. No carrier generation or delivery is authorized.

### Second operator snapshot at 17:10 UTC

At **2026-11-21 17:10:32.663204+00**, spans had **75 stale**, zero missing
or failed, with admin and whole-worker EDI counts still agreeing. Termination
remained **119,941 OK**, zero missing, stale or failed. Both configurations
remained enabled with the same IDs.

Across the **15 minutes 55.737205 seconds** between snapshots:

| Operation | Additional calls | Additional affected invalidations |
| --- | ---: | ---: |
| Upstream scan completion handoff | 381 | 469 |
| Span role-history source change | 88 | 235 |
| Span scan-worker requeue | 1 | 1 |
| Span termination-evidence change | 5 | 5 |

Pending monthly jobs fell **54,239 → 53,858** (381 fewer); processing remained
14. These concurrent figures support ongoing scan production rather than a
globally stopped scan queue, without proving each source invalidation came
from those exact jobs. The success/failure counts are rolling one-hour
windows, so their difference is not an interval completion count.

Newest OK span computation advanced **16:51:01.095 → 17:00:47.909**.
The oldest currently stale span timestamp advanced
**16:50:53.585 → 17:00:47.176**, and newest stale was **17:10:25.972**;
all 75 were unclaimed. The data demonstrates computation progress and fresh
invalidations; it does not show one unchanged set of rows stuck since the
failed check. Since an invalidation replaces `stale_at`, this is not proof
that every prior stale worker was successfully recomputed.

The operator also supplied saved cron configurations at **17:11:18 UTC**:
`denorm_backfill` enabled at `0 * * * *`, `denorm_stale` enabled at
`30 * * * *`, and `process-wmb-batch` enabled at `*/4 * * * *`.
The queued scan population covered **October and November 2026**:
26,904 and 26,938 pending respectively, with 7 processing for each.
The November processing group still included the November 20 01:18:19 pick.
No ownership/reset is inferred or authorized.

The supplied **Denorm Stale Recompute** live run reported **396 recomputed,
zero errors**, including **369 spans and 27 role-history rows**. Its UI
showed a 00:30 start, an 08:31 completion and 59.94-second duration; those
rendered times cannot be treated as one consistent timezone or correlated
to this interval without raw timestamps. In any case it is not the missing
ten-minute emitter history.

**Remaining narrow diagnostic gap:** the actual ten-minute drain is driven
by **Cron Tick Emitter**, plugin ID `cron-tick-emitter`. The earlier settings
query filtered it out. Obtain its enabled switch, saved schedule and live
history covering 17:00 and 17:10 UTC, including `emitted`, `since` and any
subscriber `failures`. A nominally successful emitter run may include
subscriber failures in its summary. The 17:10 snapshot was only 32 seconds
after the boundary; it cannot alone establish a missed or blocked drain.

These two snapshots explain recurring recent work through observed source
operations and bounded processing, but do not yet prove a specific
application defect, all-source convergence, or successful staging recovery.
No code, scheduling or maintenance correction was performed. The next step
is emitter evidence, not another blind rebuild or repeated zero-count chase.

### Emitter configuration and operator history at 17:28 UTC

At **2026-11-21 17:28:36.573606+00**, the operator confirmed
`cron-tick-emitter` configuration
`e4527c27-773a-4d65-b932-bb072dde61f9` was **enabled**, scheduled
`*/10 * * * *`. Supplied live scheduler runs were successful, lasting
**47.84 seconds** and **82.63 seconds**, and neither supplied summary
included subscriber failures. Both emitted `10m`, `1h`, `2h`, `4h`, `8h`.
Thus a disabled emitter is not supported by the evidence.

The displayed first start/completion were **01:00:00 / 09:00:47**, with
`since: 2026-11-21T08:50:00.194Z`; the second displayed
**01:20:00 / 09:21:22**, with
`since: 2026-11-21T09:10:00.140Z`. These must not be silently relabeled
17:00/17:20 UTC. Source inspection identifies a concrete timestamp
inconsistency: run creation leaves `started_at` to the database's naive
`now()` default, completion writes a mapped JS Date, and emitter dueness
uses the mapped defaulted start as an instant. In a non-UTC application DB
session this can shift the prior-run instant and re-emit coarse periods.
The external SQL client's `GMT` session does not establish the API pool's
session timezone.

This anomaly does **not** account for the observed span source invalidations:
the denorm subscriber listens only to `10m`, not the repeated coarse ticks,
and the other current tick subscriber is the usage-alert notifier, not a WMB
scan producer. Do not broaden this incident into a general timestamp rewrite
or present a timer fix as the correction for the reported coverage failure.
Full running API/DB-session identity remains unverified.

The actionable coverage finding is **ongoing source invalidations alongside
bounded, progressing span recomputation**, not missing initial population or
termination backlog. A narrowly scoped recovery attempt may be proposed:
reconfirm upstream readiness, run one bounded stale recompute for the span
plugin, refresh counts and immediately perform one fresh coverage check
without generation/delivery. This is a real maintenance write and requires
operator authorization first. Continuous scans may invalidate results during
that attempt; if it fails, retain the failure and stop rather than loop
rebuilds or bypass the readiness barrier. No recovery action has yet been
authorized or performed, and no fresh successful coverage check was supplied.

### Authorized recovery scope

The operator explicitly approved **one bounded staging recovery attempt**:
refresh upstream/span readiness, run the existing span-only **Run recompute
now** action once if upstream is current and neither producer has missing or
failed records, then admit one fresh coverage check if both producers are
fully ready. If a check is already active, reconnect rather than start another.
Opening Coverage sources may itself admit the check; that consumes the one
attempt and does not authorize an additional retry click.

The approved span configuration is
`0406b4a3-d991-452f-9b50-d475edc7caaf`; upstream termination is
`b0672afc-76ed-42d9-900e-c7c6fc7ac595`. Capture the recompute result,
refreshed counts and new coverage-check start/finish/result, then observe
readiness after the next scheduled drain cycle. If readiness does not reach
zero or the check fails, retain evidence and stop instead of repeating
maintenance.

Authorization does **not** include clearing records, backfill, eligibility
scans, changing/stopping cron jobs, resetting scan claims, deployment, carrier
generation or delivery. The operator performs the actions in their existing
authorized session; the executor still has no direct staging access.
**Approval is not evidence that an action ran or that staging recovered.**

### Ready population, followed by an ending-evidence refusal

The operator reported independently disabling **Process WMB Batch** because
its ongoing processing kept adding stale spans. This was an operator action,
not an executor change and not part of the previously approved scope, which
explicitly left scans running. Record the operational consequence: unfinished
batch scan work is paused, not completed. No re-enable or further cron change
has been authorized or performed by the executor.

At **2026-11-21 17:42:26.776829+00**, both selected denorm configurations had
**119,941 OK, zero missing, zero stale and zero failed**, with admin and
whole-worker EDI counts agreeing. The operator's one span recompute returned
**zero recomputed** and a refresh left counts unchanged. That is an empty
stale batch, not a failed recompute. This is stronger operational evidence
that ongoing scan/source work was preventing a quiet readiness observation;
it is not proof of convergence with scans enabled.

The subsequent saved check, displayed finished **2026-11-21 09:45:07 AM**,
refused with **“Coverage ending evidence needs correction:
termination-coverage-missing”**, rather than the previous stale-readiness
error. If displayed in UTC−08:00, this finish is **17:45:07 UTC**; retain the
displayed value until its raw timestamp is supplied. The attached error
lists **21 examples**, all for one benefit's **November 2026** terminations.
The reader deliberately limits its diagnostic query to 21 rows, so this
does not establish the total affected population. Do not copy the supplied
worker/event identifiers into this incident record.

The check therefore reached maintained ending-evidence validation beyond
the initial readiness gate, but **did not complete Coverage sources**.
An OK denorm status means computation completed; it does not mean the
computed payload is free of evidence issues. Span derivation records
`termination-coverage-missing` when a retained termination event has no
immediately preceding coverage month and has not been retired by current
or later coverage. For the supplied examples the missing prerequisite at
derivation was **October coverage supporting a November ending**.

This narrows the remaining blocker to source/evidence integrity or
invalidation, not an unprocessed stale-row count. Before any correction,
compare the persisted issue against current prior-month coverage, retained
event provenance, the supporting scan's status, and unfinished scan work for
that scan owner. That distinguishes a still-valid missing-source refusal
from a ready-but-outdated diagnostic or bad termination production. Do not
delete events, invent October coverage/dates, exclude people, acknowledge
the issue or repeatedly rebuild to get past it. No successful check or
carrier generation/delivery was reported; the incident remains unresolved.

### Ending-evidence classification at 17:52 UTC

The operator's **2026-11-21 17:52:51.564+00** read-only summary establishes
**60** `termination-coverage-missing` issues for the selected benefit's
November 2026 endings, not merely the error message's 21 examples:

| Event authority | Older coverage before October | Supporting scan | Unfinished owner scan work | Issues |
| --- | --- | --- | --- | ---: |
| Inferred | Yes | None linked | No | 5 |
| Inferred | Yes | None linked | Yes | 2 |
| Other/unmarked | No | Success, COBRA-case trigger | No | 2 |
| Other/unmarked | No | Success, monthly batch | No | 21 |
| Other/unmarked | Yes | Success, monthly batch | No | 30 |

All 60 span statuses were OK, their termination events still existed, and
none had October coverage at the time of this query. Thus the persisted
missing-prior-month issue is not explained by October coverage already
existing but failing to invalidate an old issue. Null linked scans on the
seven inferred events are not failed scans; historical inference has a
different authority. The owner-work flag is not a full family inventory.

Source trace found a specific semantic mismatch to investigate before
correcting the 53 scan-backed events: `benefits-scan` deliberately chooses
`scanType: continue` for a benefit present in **either the previous month
or the current month**. The termination producer interprets failed
`continue` as evidence of a previous-month grant. A deletion of current-only
coverage can therefore produce a nominal termination without that grant.
However, today's missing October rows do not prove they were absent when
each scan ran; later source corrections can also remove a formerly real
October grant. The saved per-person `previousMonthBenefitIds` can distinguish
these cases without inventing source history. Inspect its aggregate
present/absent/unrecorded classification before applying a producer repair
or touching retained events. Preserve both the original scan results and
inferred-event ownership; do not recast refused starts or current-only
deletions as historical continuation evidence.

No repair, rescan, event reconciliation or further staging maintenance was
authorized or performed on the basis of this classification. The batch job
remains operator-paused unless the operator reports otherwise.

### Initial access and deployment observations

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

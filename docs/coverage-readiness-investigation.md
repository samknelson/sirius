# Coverage readiness investigation

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
- **Scan completion and reset:** completion hands off stale upstream seeds
  atomically with persisted results. Source coverage writes and completion
  recipients also enqueue span work. Monthly requeue, single enqueue and
  single/bulk reset capture retained `people`/`actions` recipients under lock
  before removing summaries. This is necessary evidence invalidation; it is
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
generation/time ranges, queue activity and saved check timestamps in one
repeatable-read transaction without source payloads or personal details.
Capture once at zero and once after recurrence, noting which configuration
the operator opened. Compare upstream draining/computation times with new
span stale times and existing job history. A shrinking upstream backlog that
eventually stops producing changes is finite catch-up. Continuing source
mutations legitimately requeue work. Unchanged replacements must no longer
advance span generations after this fix.

The status spine has no persisted per-invalidation producer history. Timestamps
alone cannot retrospectively prove whether a particular row came from a scan,
source correction or config edit; additional authorized environment evidence
is needed for that attribution. Do not record names, eligibility payloads or
credentials to obtain it.

## Verification scope

Focused isolated PostgreSQL fixtures exercise unchanged and empty replacements,
changed authority, family invalidation, rollback, finite catch-up and convergence,
strict readiness, and failed check → completed recomputation → explicit retry
with a new identity and late-write fencing. Synthetic fixtures are not a
production recovery claim.

All 32 focused checks in `coverage-spans-postgres.test.ts` and
`coverage-evidence.test.ts` passed. One-time server rendering verified failed,
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

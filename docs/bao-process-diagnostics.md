# BAO Process reliability and fresh staging trial

The historical stalled upload's cause is **unproven**. The staging snapshots
showed Process at 68%, with a heartbeat last saved 44m30s after admission and
unchanged over 24 hours later. They do not establish an OOM, fatal application
error, stopped execution, or permission to retry.

## Deployment marker

New BAO Process admissions return HTTP 202 with `protocol: "bao-process-v1"`.
The same marker and a random `runId` are persisted at
`data.progress.process` and exposed in the load manifest and Process display.
An existing wizard without that marker is **not** evidence that the new
protocol ran. All application replicas must run the new code before the trial.
Deploy through the normal staging process; development verification does not
deploy or modify staging.

## Execution and persistence contract

- Process shares Validation's session lease namespace for the same wizard.
  The lease is in a separate four-connection pool. A stalled heartbeat cannot
  admit a second healthy executor.
- BAO Process is deliberately **one admission per wizard**, including failed,
  completed, historical stalled and interrupted runs. Neither heartbeat expiry
  nor losing the lease permits resubmission. Upstream inputs cannot be changed
  after managed admission. Review navigation does not replace wizard data.
  Deletion is refused at the atomic database transition into cleanup and at
  the final row delete, including running, failed, completed, interrupted and
  unconfirmed outcomes. Refusal happens before any attachment cleanup. The
  UI disables deletion and explains why the evidence must be retained.
  The stored type is immutable after admission: a type-only PATCH cannot
  reclassify BAO evidence to bypass retention or change its processing policy.
  Explicit null/falsy data replacement is protected too; it cannot erase
  the run marker first and thereby bypass the identity/deletion guards.
- Detached business work leaves the request's ambient transaction. Ownership
  is checked before rows and finalization phases. A row already underway can
  finish several mutations after a lease loss; this is not cancellation or
  rollback. No subsequent row or charge finalization starts after detected loss.
- One writer coalesces counts, percentage and heartbeat into one pending patch
  and one in-flight write. BAO writes are paced at most once per second;
  heartbeats are requested every 30 seconds. There is no per-row promise queue.
- Metadata uses a separate four-connection pool with bounded checkout and
  PostgreSQL `statement_timeout` capped at 15 seconds. No abandoned
  `Promise.race` update can commit later. Run-id/status predicates fence late
  writes; a database-side check also requires the owning lease backend.
- Managed BAO installs one charge collector, not nested collectors. It strictly
  flushes pending charges before generating the result file or querying result
  summaries. A flush failure is an execution failure, with partial posting risk,
  not success. Other callers retain their existing soft-flush behavior.
- The runner commits results and terminal progress in one atomic update from
  current database data. An earlier engine snapshot is never saved wholesale.
  Terminal writes receive at most three attempts per outcome. Retrying a final
  metadata write never reruns workers, hours, allocations or ledger processing.
  If completion cannot be saved, a minimal failure status is attempted three
  times. If that also fails, a safe, capped, run-scoped in-memory diagnostic and
  console log report unconfirmed persistence. The server remains alive.

## What staff should see

| Outcome | Display and action |
| --- | --- |
| Running | Saved percentage, phase, counts, run correlation; polling continues without a total-duration timeout |
| Completed | Durable completion and available review/results; no Process re-run |
| Completed with row issues | Durable results retain the existing row-level issue policy; an explicit partial-posting warning directs staff to review/reconcile |
| Execution failure | Explicit failure and possible partial posting; seek reconciliation, do not resubmit |
| Result persistence failure | Work finished but results not saved; seek reconciliation, do not resubmit |
| Unsavable terminal state | Supplemental diagnostic says final status/results are unconfirmed; seek reconciliation |
| Stale/missing heartbeat | Warning only, never “work has stopped” or retry permission |
| Browser polling error | Browser cannot read current status, distinct from server failure; keeps polling and recovers |

Refreshing or navigating away does not submit Process again. Initial status
read errors keep Run disabled until status is known. The failure diagnostic is
local to the surviving executor replica, supplemental to durable status and
CloudWatch; other replicas or a restart may show only stale heartbeat evidence.

## Safe staging procedure (operator-run after deployment)

1. Confirm the new code on **every** replica. Use a fresh synthetic file and
   wizard on an isolated test employer/period with appropriate synthetic test
   configuration. Do not use the original spreadsheet or collect PHI-bearing
   logs.
2. A different wizard for the **same employer/month** can still reconcile
   hours and ledger entries left by the old partial run. Use a different
   isolated employer/period, or obtain explicit reconciliation approval first.
   Do not reset, cancel, reuse, delete, or retry the stalled wizard as this trial.
3. Complete Upload, Map, Validate, Verify and Preview normally. Admit Process
   once. Record only run/wizard correlation, protocol, mode, row count, HTTP
   status, phase/count/timing measurements and outcome.
4. Confirm 202 plus the persisted marker, then refresh during processing.
   Tracking should survive. A stale heartbeat alone must never enable retry.
5. Confirm durable terminal status and reconcile row counts, hours, FMLA
   splits, allocations and posted charge outcomes in the authorized UI. If any
   failure or unconfirmed status occurs, stop and investigate without resubmitting.

## PHI-safe console / CloudWatch evidence

Filter all replicas' application logs for `service = "wizard-process"` and the
random run correlation. Expected messages:

- `Process admitted`
- `Process phase` (`load`, `rows`, `charges`, `results`)
- `Process progress persistence failed; execution is separately leased`
- `Process terminal persistence attempt failed`
- `Process execution or persistence failed`
- `Process terminal status unsaved`
- `Process detached cleanup failed`
- `Process run finished`

Fields contain only protocol, wizard/run correlation, phase, counts, elapsed/
duration/write milliseconds, attempt counts and `executionFinished`. Do not
include uploaded file names, names, SSNs, worker ids, row values, full wizard
JSON or underlying errors in this diagnostic channel. Existing unrelated
business/audit log channels are not made PHI-free by this work. Prefer these
specific diagnostics over exporting whole application logs.

## Reproducible verification

```sh
./node_modules/.bin/vitest run --config vitest.wizard-isolated.config.ts \
  tests/wizards/process-run.test.ts tests/wizards/bao-process-scale.test.ts \
  tests/wizards/validation-run.test.ts tests/wizards/validation-progress-db.test.ts \
  tests/wizards/bao-validation-scale.test.ts tests/wizards/bao-validation-parity.test.ts
./node_modules/.bin/vitest run tests/wizards/process-polling-ui.test.tsx \
  tests/wizards/validation-polling-ui.test.tsx tests/wizards/validation-stalled-ui.test.tsx
```

The isolated configuration starts a temporary local PostgreSQL cluster via a
Unix socket, installs the real schema/default function and foreign keys, and
never reads an application database URL or copies application data. Scale
fixtures use actual dispatcher, load/poll routes, feed parser/engine and
business storage; upload bytes and attachment outputs are synthetic in-memory
objects, authorization is stubbed for the route harness. Billing and threshold
configuration is seeded in the isolated DB, not mocked. Both existing and new
workers, Active/FMLA splits, withholding and charges are asserted. Coarse
`PROCESS_PROFILE` measurements report queries, progress writes and maximum
writer concurrency without row values. The disposable cluster disables fsync
and synchronous commit; these timings are not production latency estimates or
power-loss durability tests. Committed results are checked through separate
database reads and actual HTTP loads.

### Recorded synthetic measurements — 2026-10-08

| Input rows | Process elapsed | SQL queries | Progress writes | Max in-flight progress writes | Hours / charge rows | Withholding allocations |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 500 | 22.131 s | 33,026 | 20 | 1 | 600 | 500 |
| 2,009 | 67.843 s | 132,118 | 64 | 1 | 2,411 | 2,009 |

Every fifth row is an existing FMLA worker with a seeded 120-hour threshold;
the remaining rows create confirmed Active workers. The extra hours/charge
rows are the expected Active/FMLA split, not duplicates. Each allocation is
$12.50 and the seeded employer rate is $4/hour. Assertions compare exact
row results, aggregate hours, FMLA hours, allocation totals and charge amounts.
Query counts include business storage, deferred metadata, status polling,
terminal persistence and verification reads, not just progress writes.
There was no per-row progress queue; the controlled-delay writer remained at
one in-flight update. A separate blocked-writer test coalesces 2,009 reports
into only two writes. Machine contention, including an application restart
and concurrent verification, affects elapsed time; these are not staging SLAs.

Verification passed 34 distinct isolated database tests and 16
browser-component/parity tests. Server/client type checks, all 16 architecture
rules, and the production server bundle build passed. The restarted development
app reached ready state and its public sign-in screen rendered. The signed-in
Process page was not visually verified; component tests exercise its polling,
refresh, error recovery and partial-posting messages without bypassing auth.
Deletion tests cover live Process, completion, failed/unconfirmed outcomes,
an admission that commits after deletion's stale read, and deletion winning
before admission. Refused cleanup must not even list or remove attachments.
Type-only PATCH and subsequent DELETE are refused while actual posting runs;
the durable parent, source-file row and attachment link remain intact through
completion. A type change that wins before admission prevents a stale BAO
request from starting business work.

## Residual limits

This is not a durable queue, restart resume, all-or-nothing upload transaction,
or reconciliation tool. A restart can leave partial business writes and stale
progress. Existing row-level “issues” semantics and billing/status/matching
policies are unchanged. The result file is an external side effect and can
survive a later terminal-save failure; terminal metadata retries do not
regenerate it. The protocol does not diagnose the original historical cause.

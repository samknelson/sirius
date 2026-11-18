# Coverage evidence background verification

## Bounded discovery verification (2026-11-18)

Discovery now requests report-month groups and eligible ending groups, then
expands their historical/family closure in batches. It retains all competing
sources and boundary months, never an arbitrary lookback of history. Later
authoritative WMB rows suppress endings in SQL, including future reinstatements.
Supplemental medical evidence is requested only for reached families/months
and their report month. A shared projected index supplies generation's segment
starts and termination coverage; it is released before the fresh final check.
Neither display-status runs nor denormalized start/restart facts replace this evidence.

Safety ceilings (whole-run refusals, **not truncation**):

- One EDI operation per serving process, held through generation. Existing
  database admission still excludes overlapping steps for each wizard.
- 1,000 rows per database page, 100 coordinates per query; 125,000 retained
  coverage/relation/event records, 64 MiB serialized retained evidence, and
  400,000 scheduled states or cached lookup coordinates.
- 120 seconds of discovery, checked between bounded work units; 10-second
  database statement timeout. A last query can run until its statement timeout.
- 10,000 candidate/parent items per conflict before canonicalization; 2 MB
  cumulative review payload. Termination scan evidence refuses over 5,000
  records per generation batch.
- Progress and heartbeat share a coalescing writer. EDI admission, progress and
  terminal writes use PostgreSQL statement cancellation after at most 15 seconds,
  not abandoned JavaScript promises. Late progress cannot revive terminal state.

The opt-in test uses a **new temporary PostgreSQL cluster**, not the application
database. Command:

```
EDI_COVERAGE_PG=1 npx vitest run tests/edi/coverage-ingestion-postgres.test.ts --execArgv=--max-old-space-size=384
```

Actual ingestion: 120,000 applicable monthly rows (1,000 fictional people ×
120 months) plus 240,000 unrelated medical rows. PostgreSQL used 64 MB shared
buffers and 4 MB work memory; the Node test worker used a 384 MiB heap ceiling.
Observed discovery: **20.64 seconds**, **390.6 MiB peak RSS**, **286.5 MiB
peak used heap**, **231.5 MiB RSS growth**, **205.0 MiB heap growth**.
All **821** concurrent HTTP requests backed by `SELECT 1` succeeded; maximum
latency **78.2 ms**, maximum sampled event-loop delay **94.8 ms**. This is a
same-process HTTP/database harness, not a signed-in BAO status-route test.
The default unconstrained heap run also passed, but peaked at 614.5 MiB RSS:
transient garbage and runtime heap policy matter, not just retained JSON size.
No deployment or runtime heap configuration was changed.

The coordinate EXPLAIN ANALYZE used the existing month/year/worker/employer/
benefit unique index, four buffer hits, 0.056 ms execution in the first measured
run. No additional index or persisted span denormalization was added. Live plans
must still be checked: installations can have a different physical column order,
and local data distribution is not proof of staging performance.
Additional real-SQL cases preserve 500 duplicate parent sources with 1,000
children and verify future reinstatement suppression plus fingerprint invalidation.
The budget refusal check verifies record/key limits and subsequent admission.
The discovery → projection → primary-key integration also exercises all four
termination-role combinations, including an active parent with an ended child
under default subscriber-only settings. Events whose historical sources prove
they belong only to disabled roles remain fingerprinted but are not passed to
generation's narrower projected population. Unknown/missing last-covered evidence
still fails rather than being classified as a disabled role.

Focused verification: 207 EDI regression/HTTP tests and 15 isolated PostgreSQL
lifecycle/progress tests passed. The latter include real cancellation of a
blocked progress UPDATE, run fencing, JSON-null progress, and late publication.

### Incident boundary and safe staging confirmation

The supplied incident ends after completed stages of 32 ms (benefits),
30,242 ms (history), and 438 ms (relationships). The next operation was progress
reporting followed by history indexing. This does not identify which operation
stalled. Displayed log time, embedded application time, and UTC timestamps differ.
The supplied 2026-11-18 19:23:33 UTC health observations reported a ready process
started at 19:21:55.429Z. They do not prove OOM, the reason for replacement, or
successful recovery of the interrupted wizard.

New diagnostics distinguish phase entry/completion, database entry/completion,
progress scheduling, actual progress-write waits, counts, RSS, used heap and
external memory. A random scan identifier correlates acquisition logs without
logging member data. Infrastructure exit reasons and resource metrics were not
available here. An authorized operator must supply container/task stop reason,
exit code/OOM flag, image/revision and deployment events, memory limit and
RSS/CPU timeline, health-check failures, and PostgreSQL activity/wait/lock data
covering the original incident. Preserve both original timestamps and UTC.

Before staging acceptance, confirm sufficient **whole-process** headroom beyond
normal application usage, inspect actual query plans (roots, historical groups,
family joins, and reinstatement anti-join), and perform one authorized Carelon
check while measuring the real status and Mask Mode endpoints. Do not repeatedly
reproduce the incident or send carrier files. Local results justify retaining
in-process computation for now; they do not prove staging headroom or rule out
needing isolation on staging.

A failed/resource-limited check publishes no partial review or completion.
Status GET remains read-only; failed/unavailable polling never launches recovery.
For an interrupted in-progress record, first confirm the old container/executor
has stopped and no database work remains, then use an authorized, run-ID-fenced
reconciliation to mark that exact attempt failed. No automatic stale-heartbeat
takeover was introduced. If final persistence is unavailable, preserve the
in-progress record and investigate; do not reset ownership based on its age.

Built-in `system:edi-wizard-terminations` and the shared carrier guidance now
explain limits, confirmed failures and safe retry. No local help entries changed.
Signed-in Help dialog verification is not established by the unauthenticated
preview.

## Execution and authority

- Coverage data GET reads a saved review; it never discovers coverage.
- Coverage checks, decision saves and completion use the wizard run endpoint.
  Admission returns 202 before discovery finishes.
- The admission compare-and-set binds the loaded wizard revision. Database
  predicates exclude competing coverage/generation runs, input changes and
  deletion. Terminal writes remain fenced by run identity.
- Submitted actions carry both the source fingerprint and a canonical revision
  of configuration, parameters, termination choices and saved decisions.
  Effective administrator identity is captured at admission, not accepted from
  the submitted body.
- Progress reads remove review snapshots and decision candidate payloads in SQL.
  Review snapshots are limited to 2 MB; exceeding this fails explicitly rather
  than silently omitting conflicts. No historical coverage cutoff was added.
- Restart durability is unchanged. Missing, stale or unknown ownership does not
  authorize retries; only confirmed terminal runs are repeatable.

## Representative computation measurement

An isolated synthetic fixture contained 120,000 coverage rows for 1,000 fictional
workers, with 120 continuous months per worker (2017–2026). The fixture returned
query results in memory; these figures do **not** measure live database latency
or establish the cause of the reported 502.

| Stage | Milliseconds |
| --- | ---: |
| Resolve benefits | 1 |
| Read coverage history | 6 |
| Read family relationships | 5 |
| Index coverage history | 164 |
| Read termination evidence | 1 |
| Build coverage families | 7 |
| Trace historical families | 515 |
| Review competing sources | 169 |
| Validate evidence fingerprint | 562 |

All 120,000 rows remained relevant; no conflicts were invented. A 10 ms timer ran
111 times during discovery. Historical lookups now use indexes rather than
repeated whole-array scans; canonical fingerprinting yields in batches without
changing the canonical bytes. Runtime stage logs contain stage names and elapsed
times, not member details.

## Verification performed

- Focused HTTP tests: held-open discovery still admits promptly; repeated GETs
  do not invoke discovery; duplicate and cross-step starts are refused; stale
  evidence and stale input revisions reject actions; effective actor attribution
  is server-owned; late owners cannot publish results.
- Real PostgreSQL tests: concurrent coverage/generation admission, settings
  exclusion, deletion exclusion, JSON-null progress, terminal atomicity, stale
  publication and progress-only reads.
- Existing coverage/termination tests retain family checks, continuous history,
  reinstatement precedence and generation's before/after fingerprint validation.
- One-off browser fixture using the real components: indeterminate and counted
  progress, reload attachment, decision saving, completion, Generate readiness,
  explicit refresh, non-JSON gateway outage, retry and hours-only flow.
- Existing help browser harness: desktop/mobile Help dialogs, built-in listing,
  local help coexistence and near-miss routes. Updated stable help entry:
  `system:edi-wizard-terminations`, scoped to `/wizards/%` with explicit EDI prose.
  Shared carrier help also uses the same guidance. No database help was changed.
- Application restart and unauthenticated preview confirmed the sign-in screen.
  The live signed-in EDI screen was not verified; browser interactions used
  fictional responses without changing application authentication.

## Existing unrelated failures

The broader suites exposed eight failures reproduced unchanged in a clean
baseline worktree:

- Seven missing carrier layout fixtures in
  `tests/edi/provider-edi-conformance.test.ts`.
- The existing `/config/phone-numbers` browser-host assertion in
  `tests/help/workflow-coverage.test.ts`.

These are not evidence-discovery regressions and were not changed here.

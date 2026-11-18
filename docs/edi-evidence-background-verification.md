# Coverage evidence background verification

## Spill-backed historical families (2026-11-18)

The later supplied scan `f1a586e2-2b6a-455e-acda-102c54c46f04`
refused **125,001 retained records against 125,000**, at 63,063 ms.
It reported 51,284,468 evidence bytes, 345,891 coordinate keys,
775,229,440 RSS bytes and 641,441,000 heap bytes. This establishes a
retention-cap failure, not timeout or demonstrated OOM. It does not establish
the full reached population. The older measurements below are historical.

Discovery now uses a run-private SQLite file for evidence, complete/empty
coordinate caches, relation caches, family links, visited states, frontier,
labels and ordered fingerprint inputs. Family contributions are still partial
coordinate answers: direct lookup must fetch all competing sources. Review
streams ordered groups, including rejected sources, and projection validates
every retained dependent against selected historical parent authority.
Generation uses disk-backed ID/boundary lookups and compact contiguous segment
intervals, not all monthly rows for each person. The final independent discovery
still checks the fingerprint before exposing generated output.

Source reads remain through `storage.readOnly`; staging never writes the source
database. The deployed Dockerfile uses Node 20 Debian and includes native build
tools for the production `better-sqlite3` dependency. This has been exercised in
the Node 20 workspace, not in the affected deployed image.

### Resource and privacy contract

- Random run directories are owner-only (0700), evidence files 0600, outside
  the repository under the runtime's temporary directory. They contain sensitive
  evidence: operators must protect the container filesystem and host backups.
- Each SQLite file is limited to 256 MiB including its indexes; four coordinated
  slots limit aggregate evidence-file allocation to 1 GiB per temporary root.
  The bounded page cache is 4 MiB per file; memory-mapped IO is disabled.
  No WAL or rollback journal duplicates history. One disposable transaction
  avoids a filesystem commit per index mutation.
- Slot acquisition/scavenging is serialized by a small SQLite coordinator.
  Only demonstrably dead PIDs are scavenged; live/unknown owners are not removed.
  An abandoned directory is removed on the next acquisition, not on a timer.
  PID reuse conservatively delays cleanup rather than risking another run.
- Explicit `finally` cleanup covers successful checks, decision/completion,
  generation, errors and cooperative cancellation. Process death leaves private
  files for the next acquisition. No restart-resume promise is made.
- The 120-second evidence budget, 10-second query deadline, 125,000 live-record
  ceiling and 64 MiB accounted live-evidence ceiling remain. Whole-process
  checks also refuse above 768 MiB RSS or 384 MiB used heap. These include
  unrelated application allocations; isolated measurements do not prove
  serving-process headroom.
- Each stored value is limited to 4 MiB, each coordinate to 10,000 candidates,
  candidate-plus-parent conflict construction to 10,000 items / 8 MiB, and
  the saved review remains limited to 2 MB. Failures refuse the whole result;
  these limits never truncate evidence.
- Logs separate scanned record transfers, live retained records/serialized
  bytes, disk bytes, aggregate staging-index entries, live key high water,
  process RSS/heap and elapsed time. Serialized live-evidence bytes are not a
  claim to measure all V8 object overhead; RSS/heap checks include that overhead.
- Fingerprints use an explicit `spill-v1:` prefix and deterministic SQLite
  binary key order. Older completed reviews must be refreshed before further
  actions; a failed action still needs fresh evidence and explicit resubmission.

### Verification workload

The opt-in isolated PostgreSQL fixture now includes 550 parent/child families
across 120 months plus an old competing source connecting two families:
**132,001 relevant WMB records**. It supplies 110 MB of wide relation metadata
which is digested at the database boundary, not transferred as repeated JSON.
The fixture explicitly selects the original family, generates and encodes all
1,100 Carelon output rows, then mutates the rejected historical source and
requires stale-review rejection. No carrier delivery or production data repair
is performed.

The first successful above-cap review/projection/generation measurement was
65.207 seconds, 227 reader queries with 100 ms injected delay, peak RSS
232,615,936 bytes, peak heap 115,906,992 bytes, and 1,778 concurrent HTTP
requests with worst latency 107.6 ms. The subsequent mutation assertion in that
run hit a fixture uniqueness constraint; that fixture was corrected separately.
The final compact-interval implementation passed the complete family fixture,
including rejected-source mutation and relation-metadata invalidation:
**66.084 seconds** through generation, **221,454,336 bytes peak RSS**
(211.2 MiB), **106,284,072 bytes peak used heap** (101.4 MiB),
**1,802 concurrent requests**, worst **149.1 ms**, and all **1,100 rows**
generated/encoded. The seven other ingestion/budget cases passed in the preceding
full run; the corrected family case was then rerun independently. Full
`npm run check` and 230 focused coverage/termination/HTTP/help tests passed.
The status harness
serves HTTP plus `SELECT 1`, not the authenticated live wizard endpoint.

Built-in `system:edi-wizard-terminations` at `/wizards/%` now explains private,
finite, temporary staging. Existing failure/retry guidance remains accurate:
refresh does not repair oversized evidence or replay rejected actions. No local
database help is changed. Signed-in Help and Coverage sources UI verification
remains separate from source/API tests and the unauthenticated preview.

**Affected-deployment acceptance remains open.** After merge, an authorized
operator should confirm native-module availability, writable private temporary
storage, container disk allowance and whole-process headroom, then perform one
measured check/generation on the affected run while measuring real status
responsiveness. Review fresh evidence and resubmit intended actions explicitly.
Do not infer success from these isolated results or repeatedly retry the incident.

## Confirmed time-budget refusal and correction (2026-11-18)

The authorized log excerpt supplied for this task establishes **elapsed time**
as the breached dimension: 120,096 ms against 120,000 ms. At refusal it retained
115,111 records (limit 125,000), 47,326,319 serialized bytes (limit 67,108,864),
778,752,000 bytes RSS and 643,873,992 bytes used heap. The six preceding pages
returned 98–101 rows apiece in 95–104 ms. This proves a time-budget refusal,
**not OOM**, and does not distinguish network delay from database execution.
The excerpt lacks phase-start entries, so the last established operation is
“Coverage page,” not a proven full historical phase. The original diagnostic
overwrote its phase and reported keys=0 during retain; it did not report the
coordinate high-water count. No member-level data is required for this diagnosis.

The correction retains the original time/record/byte/key ceilings. It:

- Requests up to 1,000 exact coordinates per query using a bounded VALUES
  semi-join, while still paging results at 1,000 rows. Explicit month/year/benefit
  prefilters expose the existing index prefix; the exact tuple test remains
  authoritative (no cross-product widening).
- Caches complete direct coordinates and empty lookups. A family lookup is
  deliberately NOT cached as complete evidence for each child's other sources.
- Processes at most 1,000 frontier states per iteration and retains only
  person/benefit/month coordinates in those states, not copied evidence rows.
- Loads each reached relation once, including negative-cache entries. Family
  authority fields stay intact; arbitrary JSON metadata is represented by a
  PostgreSQL SHA-256 digest, so edits still invalidate fingerprints without
  repeatedly transferring or retaining that payload. This representation change
  can require explicit re-review of previously saved decisions; it never silently
  carries an old approval forward.
- Reports every breached budget dimension, observed value and limit, meaningful
  phase, scan reference, wizard ID and execution run ID. Counts and memory remain
  in server console logs. The structured refusal is also stored in fenced wizard
  progress. Starting a new check clears the old diagnostic.
- Refuses decision/completion submissions after a failed check until a fresh
  explicit check completes. A failed refresh cannot leave the step completed.
  Refresh performs only `check`; it does not replay a refused decision.

### Local verification and live acceptance boundary

The opt-in fixture still creates its own temporary PostgreSQL cluster: no source
coverage, carrier delivery or app database is modified. It now adds **100 ms to
every real reader query**, matching the supplied page-latency scale on top of
local database execution. The historical fixture has 120,000 relevant rows
(1,000 people × 120 months) and 240,000 unrelated medical rows. The separate
family fixture has 400 parent/child families × 120 months = 96,000 rows and
400 wide relation metadata objects (80 MB raw metadata alone). All evidence is
reviewed; no historical months or competing candidates are discarded.

Runtime bounds remain a 384 MiB Node heap, PostgreSQL shared_buffers=64 MB and
work_mem=4 MB. Measurement JSON under ignored `generated-artifacts/` includes
durations, reader query counts, sampled peak RSS/heap, concurrent HTTP+SELECT 1
response latency, and EXPLAIN ANALYZE/BUFFERS for direct and family batches.
The HTTP harness is not the live authenticated wizard status endpoint.

The initial corrected 100-coordinate variant required 1,225 reader queries
for 120,000 rows; at 100 ms per query, latency alone exhausts 120 seconds.
The 1,000-coordinate variant uses 247 queries, without raising a safety ceiling.
Final indexed-variant measurements (100 ms injected per query in both cases):

| Population | Duration | Reader queries | Peak RSS | Peak used heap | Concurrent HTTP requests | Worst HTTP latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 120,000 historical rows | 31.285 s | 247 | 351.9 MiB | 248.9 MiB | 1,424 | 76.7 ms |
| 96,000 family-history rows | 20.135 s | 153 | 384.0 MiB | 283.9 MiB | 917 | 36.1 ms |

The 1,000-coordinate direct EXPLAIN completed in 4.85 ms using `baseline_wmb`;
the 400-parent family EXPLAIN completed in 110.728 ms using its bitmap index
path. A tuple-only intermediate plan scanned installation history and took
2,190.262 ms for the family query; explicit month/year/benefit prefilters
removed that avoidable work without altering the exact-coordinate predicate.
No index, infrastructure, runtime heap setting or resource ceiling was changed.
Sampled event-loop maximum for the historical scan was 85.1 ms. RSS includes
the test runner and transient garbage, not just retained evidence; these
numbers do not establish headroom in an already-loaded serving process.

Safety checks cover all four budget dimensions, exact/empty/family-subset cache
semantics, future reinstatement, competing family sources, metadata fingerprint
invalidation, every termination-role combination, and an actual 125,001-row
database refusal followed by successful discovery admission. HTTP tests cover
structured failure persistence, no partial decision/publication, rejection of
completion after failure, explicit fresh-check recovery and existing run fencing.
Final checks: seven opt-in PostgreSQL/budget tests and 230 focused
coverage/termination/HTTP/help tests passed. Full `npm run check` passed, and
server TypeScript was rerun successfully after the last query changes.

Built-in `system:edi-wizard-terminations` (`/wizards/%`) and shared carrier prose
explain where to find the refusal reference and diagnostics. Authenticated test
handlers verify sanitized help, matching and near-miss routes; local help is
unchanged. The running preview was checked at its sign-in screen. Neither the
live signed-in Coverage Sources flow nor its Help dialog was verified.

**Live acceptance remains open:** the supplied excerpt establishes the failure
dimension but not the affected population's full size, distribution, query plans,
or whole-process memory headroom. These are latency-matched isolated proofs,
not proof that the affected live wizard now completes. After merge, an authorized
operator should perform one measured check on the affected run, inspect its
fresh review, and explicitly resubmit any intended decision/completion. Do not
repeatedly retry unchanged oversized evidence, reset a stale heartbeat, or send
a carrier file as part of verification.

## Bounded discovery verification (2026-11-18)

The following records the earlier implementation/measurements; the correction
above supersedes its 100-coordinate batching and full relation retention.

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

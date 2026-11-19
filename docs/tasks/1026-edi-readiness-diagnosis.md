# EDI readiness diagnosis and verification

## Status

**SQL repair implemented and verified on the affected database.** The supplied remote plan locates the high estimated
cost in the coverage-population scan, not the indexed denorm join. The calendar
predicate now uses exact year/month pairs that the existing month/year-leading
unique index can search directly. A subsequent narrow benefit/calendar/worker
index is included in an authored migration to reduce the measured wide-index
I/O. No cast, timeout increase or readiness bypass was introduced.

The original task describes February–March 2026. The subsequently supplied log
on November 19, 2026 describes a different run: Carelon EAP (CARELONEAP),
as-of November 15, 2026, lookback one, subscriber terminations enabled and
dependent terminations disabled. Its readiness population is October–November
2026, with both restart and termination maintenance required.

The log confirms SQLSTATE `57014`, severity `ERROR`, routine
`ProcessInterrupts`, after 10,714 ms in Checking lifecycle events. This strongly
supports the ten-second statement timeout but does not prove its subtype:
`57014` is also used for external cancellation. The phase includes config and
site-wide status reads before the population aggregate, so its elapsed time
alone does not isolate the slow statement.

`scripts/tools/edi-readiness-plan.sql` is a bounded, read-only diagnostic for
the newly reported scope. It returns actual types, indexes, statistics and
plan-only EXPLAINs for one and two configs, without executing the aggregate.
Run it on the affected database and retain result sets and NOTICE messages.
It refuses absent or ambiguous benefit/config matches instead of guessing.
No staging connection was supplied or accessed. Local evidence below does
not establish the remote plan.

The local database has no CARELONEAP benefit, so the exact diagnostic correctly
refused there. Its SQL execution was checked read-only using a local benefit
instead, without changing the saved script. This confirms diagnostic syntax,
not remote performance or the reported benefit's data. Include the console's
NOTICE output when returning plans; some query tools only display row results.

The remote results subsequently supplied confirm PostgreSQL 17.12, 4 MiB
work_mem, random_page_cost 4, enabled JIT and the expected indexes/types.
They report approximately 960,296 live denorm rows and 46,385 dead rows;
trust_wmb statistics estimate 154 live and 1,140 dead rows, with no analyze
timestamp. These are statistics estimates, not verified population counts.
No query plan was supplied. A local experiment adding 960,000 unrelated
denorm rows still used indexed probes for a small population (about 56/73 ms
with one/two configs, including the local coverage scan); it did not reproduce
the remote cancellation. No speculative SQL fix followed this experiment.
That one-off experiment was not retained as an additional permanent test.

The diagnostic now also returns `sql_to_run`: a constant-valued two-config
EXPLAIN script whose results are ordinary JSON rows, not NOTICE messages.
Execute that returned script on the affected database if notices are hidden.

## Initial findings (before the remote plan was supplied)

- The aggregate runs inside `readOnly.query`: a read-only transaction with a
  transaction-local 10,000 ms statement timeout and ambient transaction binding.
- PostgreSQL's actual development schema has `varchar` for both
  `trust_wmb.worker_id` and `denorm.entity_id`, and for both benefit/config IDs.
  `denorm.status` is an enum. No UUID-versus-text operator failure reproduced.
- Development has the declared unique `(entity_id, config_id)` denorm index.
  Its database estimates were 2,218 coverage rows and 1,215 denorm rows.
  February–March 2026 contained 308 coverage rows across 20 distinct people,
  across all benefits. This is not staging-scale evidence.
- A bounded read-only `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)` on development,
  selecting its largest local benefit for those months and both maintenance
  configs, used the denorm unique index. It returned 34 joined rows (17 people
  times two configs); execution was 43.104 ms and planning 236.830 ms.
  This discovery query selected local configuration IDs through a subquery;
  the isolated fixture below executes the exact application parameterized SQL.
- The isolated PostgreSQL 16 fixture executes the unchanged application query
  with one and two configurations. Both succeed. Its scale case has 60,000
  distinct people, 1,440,000 coverage rows (all months of 2025–2026), and 120,000
  denorm rows plus small correctness fixtures. All fixture data is fictional;
  the cluster has no TCP listener and is removed afterward.
- Scale `EXPLAIN ANALYZE` execution: **186.735 ms** for restart-only and
  **220.882 ms** for restart plus termination. Application transaction times
  including both EXPLAIN ANALYZE and a second execution were 364 ms and 434 ms.
  Population selection used a parallel sequential scan; the two-config plan
  used a hash join and spilled a sort to approximately 7.4 MiB of temporary
  disk. Neither reached the unchanged timeout. These local-socket synthetic
  timings do not model staging contention, network latency, full denorm
  volume, realistic identifier lengths, or server settings.
- A deliberate missing-table fault in the disposable cluster produces a real
  nested PostgreSQL `42P01`, severity `ERROR`, routine `parserOpenTable`.
  This verifies cause extraction from Drizzle, **not** the reported cause.

## Changes made

- Evidence phases now recognize Drizzle errors and nested PostgreSQL/network
  errors. Staff see the failing phase, a safe reason and a diagnostic reference,
  never the SQL-and-parameters wrapper.
- Administrator console diagnostics retain the nested SQLSTATE, severity,
  routine, elapsed phase time and wizard/run correlation, without SQL,
  parameters, database detail or row data. The original error remains the
  exception cause but is not relayed in progress or logged by this handler.
- Cancellation (`57014`) is described accurately as cancellation, possibly a
  timeout, rather than proof that the ten-second statement timeout expired.
- Business refusals and resource-budget errors retain their existing messages.
  Missing/pending/error lifecycle classifications, distinct-person counting,
  benefit/month scope, carrier rules, coverage authority and all resource
  ceilings are unchanged. Failed reads do not become empty successful results.
- Existing EDI help (`system:edi-wizard-terminations`, `/wizards/%`, shared with
  provider configuration help) explains the new database reference and where
  administrators find diagnostics. No local help records were modified.

## Repair after receiving the remote plan

The remote plan has total estimated cost 297806.27. Its population Unique
subtree already costs 286451.78 (approximately 96%); the underlying parallel
sequential scan of trust_wmb costs 285359.05. These are planner costs, NOT
milliseconds. The denorm join correctly uses both columns of
denorm_entity_config_uniq. Optimizing denorm was therefore not justified.

The arithmetic month-index BETWEEN has been replaced with OR-ed exact
year/month equalities. It represents the identical closed interval, including
cross-year windows; a person still counts only once across benefits/months.
All missing/pending/failed classification, enabled-maintenance prerequisites,
population scope and the ten-second timeout remain unchanged.

The PostgreSQL fixture now includes the deployed month/year-leading unique
index. Its 60,000-person / 1.44-million-row scale plan uses Bitmap Index Scans
on that index rather than a sequential scan of trust_wmb, for both one and two
configs. Execution measured 185.375 ms / 234.978 ms on the local synthetic data;
these do not establish a staging speedup. The fixture asserts indexed population
access and verifies December/January pairing and single-month scope.
Eleven PostgreSQL tests and 197 relevant EDI/help tests pass after the repair;
server/client typechecking also passes.

The diagnostic's returned sql_to_run now performs EXPLAIN ANALYZE on the
REPAIRED October–November aggregate. It executes the query for measurement in
a read-only transaction, retaining the ten-second limit. Its JSON output is
intended to verify the actual affected-database plan and elapsed time.

## Verification

- `EDI_COVERAGE_STARTS_PG=1 npx vitest run tests/edi/coverage-starts-postgres.test.ts --silent=false --reporter=verbose`
  — 11 passed, including ready, missing, pending, failed, empty, per-config
  gating, distinct-person and date/benefit boundaries, maintenance recovery,
  actual PostgreSQL cause extraction and the scale measurement.
- `npx vitest run tests/edi/coverage-evidence.test.ts tests/edi/coverage-segments.test.ts tests/edi/termination-output.test.ts tests/edi/deliver-export.test.ts tests/help/workflow-help-routes.test.ts`
  — 197 passed. The background HTTP dispatcher fixture saves the safe error,
  exposes `ready: false`, refuses acknowledgement, refuses generation when the
  same read fails, denies output download and permits a later successful check.
  No real file was generated or sent.
- `npm run check` — passed (server and client).
- `npm run lint` — all 16 architecture checks passed.
- Restarted `Start application`; startup logs confirm full initialization.
  The preview screenshot renders the sign-in page. The signed-in wizard and
  Help dialog were not browser-verified; background retry and help behavior
  were verified through the isolated authenticated HTTP fixtures above.
- A broader help run additionally found one unrelated existing failure in
  `tests/help/workflow-coverage.test.ts`: the browser-host inventory does not
  recognize `/config/phone-numbers` for
  `system:contact-field-configuration`. That help entry and its test were not
  changed. Focused authenticated help-handler tests pass, including
  sanitization, local-help preservation and positive/negative route matching.

## Affected-database execution result and final index

The supplied measured remote JSON plan confirms the repaired aggregate
completed in **9094.427 ms**, processing 45,221 coverage records into **23,187
distinct people** and 46,374 joined maintenance rows, returning two config
aggregates. Planning took 0.220 ms. The population now uses bitmap index
scans, not a full sequential history scan. This is remote measured evidence,
unlike the synthetic timings above. Readiness status values themselves are
not included by EXPLAIN; it does not prove all 23,187 people are ready.

The wide existing index still read 11,882 blocks and spent approximately
6,006 ms constructing the population bitmap. The denorm hash join scanned
960,320 rows in approximately 2,249 ms. Given only about 0.9 seconds of
remaining headroom, the final change adds
`trust_wmb_benefit_calendar_worker_idx (benefit_id, year, month, worker_id)`
in both the schema and authored core migration 1224 (registered normally,
idempotent, optional trust_wmb table guard). This avoids scanning unrelated
benefits through an index with benefit last. Same-year month values are
grouped into one IN predicate to support efficient covering index reads.

The final PostgreSQL fixture verifies this exact index is used, with local
execution times **181.251 ms** (one config) and **223.793 ms** (two configs)
for 60,000 people / 1.44 million coverage records. No claim is made that these
are remote post-index timings. The final index must reach the affected database
through the normal migration path; its remote creation and post-index timing
were not observed. The original February–March shape was verified locally;
the measured remote run was October–November.

No carrier file was generated or transmitted. Background retry, failed-read
acknowledgement refusal and output refusal were verified in authenticated HTTP
fixtures; a signed-in remote wizard retry was not observed.

The optional `npx tsc -p tsconfig.scripts.json --noEmit` check reports 12 existing
errors in `scripts/oneoffs/smoke-s1-write-fence.ts`, all referencing retired
`storage.cronJobRuns`; none reference this migration. This separate smoke
script was not changed as part of the readiness repair.

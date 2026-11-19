# EDI readiness diagnosis and verification

## Status

**Not complete: the reported staging failure has not been reproduced and its
underlying PostgreSQL cause is not available in this workspace.** No evidence
currently justifies changing readiness SQL, schema prerequisites, or limits.
The original aggregate is intentionally unchanged rather than applying a
speculative cast, index, timeout increase, or readiness bypass.

The available task description specifies February–March 2026 but supplies no
failing benefit ID, wizard ID, nested database error, staging connection, or
staging query plan. Local evidence below does not establish the staging cause.

## Findings

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

## Verification

- `EDI_COVERAGE_STARTS_PG=1 npx vitest run tests/edi/coverage-starts-postgres.test.ts --silent=false --reporter=verbose`
  — 10 passed, including ready, missing, pending, failed, empty, per-config
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

## Remaining evidence required

Obtain the reported staging wizard/benefit identity and nested SQLSTATE/server
diagnostics through authorized access. Reproduce the exact February–March 2026
scope in a bounded read-only session on that environment. If the cause implicates
performance, capture its plan under the existing limit before selecting a narrow
query or authored migration fix. Rerun Check coverage again without generating
or delivering a carrier file. Until then, this task remains blocked rather than
claiming the reported query is fixed.

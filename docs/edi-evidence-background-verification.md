# Coverage evidence background verification

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

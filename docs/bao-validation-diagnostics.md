# BAO Validate diagnostics

## Finding and limits

The reported deployed timeout was **not reproduced locally**. Available development data contained three small, completed BAO uploads, all in create mode; no large failing upload, original file, or failing run was available. The deployment-log lookup returned no logs. Production was not mutated, and its deployed revision, process interruptions, file-download latency, and database/network latency could not be established.

The demonstrated cost boundary was **update-mode worker existence lookup**: one sequential database lookup per valid SSN, consuming roughly 95% of row-validation time at 2,000 rows. Create-mode validation does not perform those lookups and was already fast. Therefore the bulk-lookup fix is not claimed as the proven cause of the user's create-mode/deployed symptom.

Additional reproduced reliability boundaries were delayed/rejected progress writes, terminal persistence failures, and browser polling failures. The old progress path allowed concurrent writes; a stale heartbeat alone could admit a second healthy run; failure to save a failed status could reject the detached promise; and polling errors had no distinct operator outcome.

## Scale evidence

Both sweeps used the actual BAO Validate dispatcher, real CSV/XLSX parsing and column mapping, and development PostgreSQL wizard/result persistence. Authentication gates and attachment metadata/download were isolated test substitutes; downloads supplied synthetic bytes, not remote filesystem reads. The final sweep also uses the real wizard load route and manifest. It does not run Verify, Preview, or Process.

Fixtures contain 90% Active / 10% FMLA, alternating ISO and two-digit-year DOBs, blank/positive hours and dollar-formatted withholding. Create fixtures accurately finish with every row valid. Update fixtures intentionally use missing workers and finish with every row invalid and 12 sampled existence errors. Separate parity fixtures cover existing workers, padded/duplicate SSNs, SSA warnings, absent SSNs, invalid dates, negative values, whitespace addresses, employer mappings, unmapped-only versus otherwise-invalid rows, and Disability flag/reject.

Observed total time, including HTTP admission and polling (milliseconds, rounded):

| Rows | Format | Mode | Before | After |
|---:|---|---|---:|---:|
| 500 | CSV | create | 388 | 208 |
| 500 | CSV | update | 1,757 | 93 |
| 500 | XLSX | create | 187 | 130 |
| 500 | XLSX | update | 1,790 | 278 |
| 2,000 | CSV | create | 332 | 218 |
| 2,000 | CSV | update | 5,747 | 173 |
| 2,000 | XLSX | create | 287 | 382 |
| 2,000 | XLSX | update | 8,008 | 282 |

These are development observations, not production latency guarantees. Small create-mode differences are noise from pool startup, concurrent test suites, parsing and poll timing; no create-mode speedup is asserted.

Measured 2,000-row update phases:

| Phase | Before CSV / XLSX | After CSV / XLSX |
|---|---:|---:|
| Load/download/parse/map | 22 / 100 ms, one load each | 20 / 129 ms, one load each |
| Worker database lookups | 5,462 / 7,584 ms, **2,000 SELECT calls each** | 14 / 19 ms, **one bulk SELECT each** |
| Row validation | 5,606 / 7,797 ms including per-row lookups | 27 / 29 ms exclusive of bulk preparation |
| Bulk preparation, including SSN normalization | not separate in old path | 20 / 21 ms |
| Result-only merge | 6 / 13 ms, one UPDATE each | none |
| Claim + progress + completion UPDATE calls | 22 each; summed 250 / 358 ms | 6 / 7 total; summed 19 / 18 ms |
| Terminal result+status persistence | completion included in preceding old aggregate; no separate old sample | one UPDATE each, 2.0 / 2.4 ms |

The first sweep aggregated claim/progress/completion timings; it did not isolate completion latency. Old progress calls overlapped, so summed write latency is not wall time. New metadata writes also execute BEGIN, local timeout setup and COMMIT/ROLLBACK; UPDATE counts above are data-write counts, not counts of all protocol statements. Option/mapping caching is preserved, with one option read and at most one employer-mapping read per run, demonstrated by parity/concurrency tests.

## Changes and trustworthy outcomes

- Update validation bulk-resolves normalized, SSA-valid SSNs once. Warning SSNs still skip existence errors; isolated row calls retain the original single lookup.
- Validation yields between 100-row batches. Progress has one in-flight write and one coalesced pending patch; heartbeats use the same writer. Failed progress writes are counted and reported without aborting healthy row work.
- A database-session advisory lease excludes simultaneous validation on the same wizard across processes, even with stale persisted heartbeats. Its separate, bounded pool does not consume the main work/poll connections. Process/connection loss releases the lease.
- Validation metadata writes have a PostgreSQL-local 15-second statement timeout and bounded connection checkout, rather than a JavaScript timeout that leaves a late UPDATE running. Terminal saves retry at most three times. Results, warnings, reconciled counts and completion commit in one run-id-guarded UPDATE.
- Existing atomic run guards reject late writes after terminal completion or replacement. A stale, abandoned run can retry after heartbeat expiry, but an actively held lease still refuses it.
- Run failures, result-persistence failures, missing persisted heartbeat and browser status-read failures have different messages. An unsavable terminal status is logged explicitly and exposed as a supplemental, run-scoped diagnostic while that process survives; after restart, stale-heartbeat recovery remains necessary.
- Browser polling continues on initial/background errors, after refresh/remount and beyond four minutes. A request failure does not prove the server failed. The server's `validation-v2` response/progress marker helps distinguish an old deployment from this implementation.
- Validate writes wizard data only. Mutation spies cover workers, hours, ledger entries and withholding allocations. No billing, eligibility, employment-status or storage policy changed.

## Verification and operational diagnosis

Run:

```sh
npx vitest run tests/wizards/bao-validation-scale.test.ts \
  tests/wizards/bao-validation-parity.test.ts \
  tests/wizards/validation-run.test.ts \
  tests/wizards/validation-polling-ui.test.tsx \
  tests/wizards/validation-stalled-ui.test.tsx \
  tests/wizards/validation-progress-db.test.ts \
  tests/wizards/feed-address-validation.test.ts \
  tests/wizards/feed-date-validation.test.ts
```

All **169 tests passed**. Full scale tests assert that `validateRow` actually ran 500/2,000 times, read the actual step-data route before and after validation, reload saved results, check terminal state and manifest, and assert no business mutations. Real PostgreSQL tests cover expired heartbeat admission, lease exclusion, late writes, a row-lock-blocked UPDATE cancelled in PostgreSQL, transient and persistent terminal-save failures. Browser-component tests use real React Query, five minutes of simulated polling, remount and network recovery; they do not merely inject a pre-completed 2,000-row result into the scale test.

The restarted app reached ready state and its public sign-in screen rendered. The signed-in page was not visually verified; authentication remains intact. Capture-browser HMR connection warnings were present, along with expected unsigned-in 401s and missing optional login-variable 404s.

For the next real failing run, collect only safe metadata: wizard/run identity, upload mode and row count, persisted status/heartbeat/protocol, HTTP status of the run/load/data requests, and coarse phase timings. Saved `validationResults.diagnostics` separates load/parse/map, bulk preparation and row time; `FEED_PROFILE` enables coarse engine timing logs, and `Validation run finished` records progress/terminal write attempts, failures and durations. Failure logs name the phase without relaying row values or connection errors. Inspect every application replica's logs and confirm that admission and polling reach the same deployed version. Do not collect file contents, row values, worker identifiers or credentials.

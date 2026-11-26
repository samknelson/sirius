# T631 worker reconciliation measurements

## Scope and duration definitions

Measured on 2026-11-17 against isolated synthetic PostgreSQL tables, not
production records. No T631 request or real import was made.

The reported 33 seconds versus 378 seconds cannot be attributed from those
two numbers alone. The vendor result's existing `durationMs` stops when
response **headers** arrive. It does not include reading, redacting, or
decoding the response body, nor local reconciliation. The background job's
start/completion interval includes all those phases plus finalization.
Which of these the original report measured is not independently established.

Vendor results now add `timings` (headers, body read, body processing, total).
The completed sync writes one aggregate phase-timing log with fetch-wrapper
time, remote timings, local reconciliation, finalization, source row counts,
changed/unchanged row counts, skips/errors, and deactivations. No payload,
identity, phone number, credential, or worker detail is included in this log.
Changed/unchanged row counts cover all worker changes, unlike the legacy
`unchanged` counter, which describes EIN reconciliation only.

## Comparable replay

Three runs per version, 200 already-linked numeric T631 identities received
using their I-prefixed spellings. Each run starts with 200 correct EINs:
first replay keeps them, second replaces all 200 EINs. Blank phones, no
selected member statuses, no missing workers. Both versions use a transaction,
an advisory transaction fence and a status-check round trip per worker.

The replay uses the real identity storage and real PostgreSQL queries.
Other subsystems are deliberately isolated: full worker hydration is modeled
as its four round trips, blank-phone lookup as one, and the logged mutation
facade delegates to real ID writes without running the audit/event machinery.
Thus this measures reconciliation round trips and lock costs, **not** full
application throughput or audit/provenance overhead.

| 200-row fixture | Before | After | Change |
| --- | ---: | ---: | ---: |
| Unchanged queries | 3,602 | 2,202 | −38.9% |
| Changed queries | 4,002 | 2,602 | −35.0% |
| Table lock requests, either fixture | 400 | 200 | −50% |
| Unchanged reconciliation median | 2,163.8 ms | 1,616.6 ms | −25.3% |
| Changed reconciliation median | 1,822.8 ms | 1,582.6 ms | −13.2% |

Raw reconciliation samples (ms):

- Before unchanged: 2173.1, 2163.8, 1993.9.
- Before changed: 1819.1, 2042.1, 1822.8.
- After unchanged: 1779.5, 1502.7, 1616.6.
- After changed: 1582.6, 1819.7, 1579.4.

JSON decoding for these small synthetic bodies took 0.11–0.41 ms before and
0.13–0.37 ms after. Remote network/body-transfer time is deliberately absent,
not assumed to be zero in production. Finalization was not benchmarked;
the live aggregate timing log measures it separately.

Uncontended table-lock request time (includes round trip, not pure waiting)
was 79–96 ms total before versus 43–50 ms after for unchanged rows, and
68–74 ms versus 34–38 ms for changed rows. Afterward the lock was held for
490–547 ms total across the unchanged units and 557–641 ms across the changed
units, measured from grant until COMMIT was issued. No queued pool acquisition
was observed (peak `waitingCount` zero); pool initialization/checkout latency
was not separately measured. These local results do not estimate production
lock contention, pool latency, or vendor latency.

The retained `tests/sitespecific/t631-overhead-replay.test.ts` uses four rows
rather than 200 for normal checks and includes direct-SQL contention,
mutation-invalidation and rollback checks. To repeat a timing experiment,
increase its fixture count to 200, time the `syncWorkerEins` calls, and count
client queries; restore the small count afterward. Use the same isolated
fixture and baseline revision, never real worker mutations.

## Changes and safety boundary

- Reuse repeated identity lookups only inside one live worker transaction
  after taking the existing `SHARE ROW EXCLUSIVE` table lock.
- Reuse that lock rather than requesting it again during reconciliation.
- Clear the read cache on every public ID create/update/delete and discard it
  on scope exit, including rollback. Preview has no cache and takes no write
  lock. Source-ID revalidation still reads the worker's IDs afresh.
- Fetch only `contactId`, not the worker plus three denormalized collections.
- Reject a missing source ID before opening its worker unit; validate invalid
  phone input before reading local numbers. Existing identity matches are still
  added to the seen set before conflicting/blank-EIN rows are skipped.
- Select only currently EDLS-active missing-worker candidates and recheck
  status and activity inside each protected deactivation unit.
- Keep member-status history semantics, logged mutation facades, per-unit
  ownership checks, maintenance checks, recovery and terminal fences intact.

The table lock intentionally remains held through phone/status processing.
Releasing it earlier or replacing it with an advisory lock would not protect
against every existing ID writer. The reduction comes from less work under
the lock, not weaker exclusion. There is no run-wide mutable-state cache,
unbounded parallelism, or change to cron scheduling.

Remaining costs include serial fenced transactions, pool/session setup,
audited changed-worker writes, phone/status work, table-lock contention, and
the remote service. The new phase timings are needed on a naturally scheduled
or operator-requested run to locate the remaining production bottleneck; the
synthetic improvement is not a promise to restore a 33-second runtime.

# Worker queue reads — task 612

## Scope and evidence

Measured on an **isolated local PostgreSQL 16.10 cluster**, not the application
database or production. Data is intentionally synthetic test data: 500,000
queue rows, 10,000 workers, 50 runs, 50 rows per worker, 490,000 terminal rows
and 10,000 active rows in the newest run (9,000 pending / 1,000 processing).
Each row includes representative JSON result data. The baseline has the queue
primary key and existing `(status_id, worker_id)` unique constraint only.

The last 1,000 rows use `worker_update`; the other rows use `monthly_batch`.
Thus the filtered drainer must skip thousands of earlier monthly jobs, not
merely find a conveniently placed matching first row. Every seventeenth row
has a NULL schedule. Ordering, filters and status semantics are unchanged.

These measurements establish query/index behavior for that population, **not**
production latency, a production root-cause diagnosis, or a service-level
guarantee. Hardware contention and cache state vary between runs. The first
EXPLAIN pass includes some physical reads; concurrent measurements exercise
both phases repeatedly. No forced planner settings or disabled sequential
scans were used.

## Before/after SQL plans

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, milliseconds, one representative
500,000-row run. Claim UPDATEs are explained inside rolled-back transactions.
Full JSON plans and concurrent timing evidence are retained in
[`wmb-queue-performance-evidence.json`](wmb-queue-performance-evidence.json),
the harness's default output path.

| Query | Baseline execution ms | Indexed execution ms | Indexed hit/read blocks |
|---|---:|---:|---:|
| Latest success/failed for worker | 33.828 | 0.090 | 54 / 0 |
| Worker pending/processing months | 28.133 | 0.180 | 14 / 0 |
| Claim next pending | 53.462 | 0.065 | 28 / 0 |
| Claim eligible source only | 59.220 | 1.812 | 330 / 0 |
| Remaining-run COUNT, 10k active | 2.563 | 1.420 | 15 / 0 |
| Remaining-run LIMIT 1, 10k active | 45.247 | 0.017 | 3 / 0 |
| Remaining-run COUNT, no active | 8.619 | 0.017 | 2 / 0 |
| Remaining-run LIMIT 1, no active | 50.493 | 0.018 | 2 / 0 |

Plan shapes (index names shortened below):

* Worker latest: parallel sequential scan → gather/merge/sort/limit became
  worker-index bitmap scan → worker-local sort → limit.
* Worker queued: parallel sequential scan → sort became bitmap AND of
  worker and active-run indexes → small sort.
* Claim, filtered and unfiltered: sequential scan → sort → LockRows → limit
  became ordered pending-index scan → LockRows → limit. The outer UPDATE
  still locates the chosen row by the primary key.
* Remaining COUNT: bitmap scan via existing status/worker constraint became
  active-run index-only scan.
* Remaining LIMIT 1: sequential scan became active-run index scan → limit.

**Do not deploy the COUNT-to-existence change without the active-run index.**
Without it, the planner chose a sequential scan for LIMIT 1, making the
existence query slower than COUNT on this distribution. With the partial
index, existence avoids scanning 10,000 active index entries. An empty run
is also cheap rather than scanning completed history.

## Pool checkout versus query time under background load

Four foreground lanes repeatedly execute the two worker scan-state reads;
four background lanes alternate unfiltered claims, filtered claims, remaining
COUNT and remaining LIMIT 1. They contend for a real **four-connection pool**.
Each lane runs 15 transactions (120 total); transactions are rolled back to
preserve the same population. Foreground reads have 30 samples per query;
background queries have 12–16. This deliberately retains the old count query
as a comparison, not as a model of the changed application's exact workload.

Checkout is measured from `pool.connect()` call until it resolves. Query time
starts after checkout and BEGIN, and ends when the statement response arrives;
it includes local driver/socket/result decoding but excludes checkout, BEGIN
and ROLLBACK. EXPLAIN execution time above is the server-only measurement.
No pool-size increase was required.

| Query | Checkout p50 before → after ms | Checkout p95 before → after ms | SQL p50 before → after ms | SQL p95 before → after ms |
|---|---:|---:|---:|---:|
| Worker latest | 39.15 → 1.83 | 137.43 → 3.30 | 39.70 → 0.60 | 234.13 → 1.21 |
| Worker queued | 38.77 → 1.69 | 61.03 → 3.08 | 37.28 → 0.76 | 218.35 → 1.30 |
| Claim | 48.96 → 1.42 | 68.48 → 3.27 | 59.49 → 0.87 | 81.86 → 1.86 |
| Filtered claim | 47.78 → 1.29 | 143.87 → 2.66 | 69.43 → 2.35 | 240.37 → 6.25 |
| Remaining count | 35.23 → 1.61 | 234.96 → 2.20 | 2.36 → 1.01 | 4.09 → 4.30 |
| Remaining existence | 52.05 → 1.46 | 221.46 → 2.42 | 32.59 → 0.37 | 59.27 → 1.53 |

Both actual SQL work and waiting behind other work improve. A slow endpoint
therefore should not automatically be attributed entirely to SQL execution.
The small samples and occasional scheduler outliers do not support a precise
production p95 prediction.

## Smallest justified index set

1. `trust_wmb_scan_queue_worker_idx (worker_id)` — 3,768,320 bytes.
   Worker-local sorting of 50 historical rows is cheap. A wider
   worker/status/completed index was not necessary for this population; the
   simple prefix also serves other per-worker reads.
2. `trust_wmb_scan_queue_pending_claim_idx (scheduled_for, id)
   WHERE status = 'pending'` — 385,024 bytes. Default ascending ordering has
   NULLS LAST, exactly matching the claim query.
3. `trust_wmb_scan_queue_active_run_idx (status_id)
   WHERE status IN ('pending', 'processing')` — 90,112 bytes.
   Keeps completion checks independent of historical run size.

Schema/migration predicates use explicit text casts to match PostgreSQL
catalog reflection. The harness uses the same installed names and predicate
forms. New indexes total about 4.05 MiB versus about 48.18 MiB for the existing
primary/unique indexes in this fixture. Partial indexes avoid indexing the
490,000 terminal rows.

No trigger-source-leading fourth index is justified by these measurements.
The filtered pending scan still examines earlier unrelated pending jobs:
very large/skewed pending backlogs may warrant renewed measurement, not an
assumption that this three-index set solves every future distribution.

## Correctness checks

`scripts/dev/benchmark-wmb-queue.ts` checks matching results, missing workers,
claim timestamp/id ordering, filtered claiming, status/attempt updates,
remaining counts and two-session `SKIP LOCKED` before and after indexing.

`tests/wmb/wmb-queue-storage-postgres.test.ts` additionally executes the **actual
Drizzle storage methods** against a fresh local cluster, replacing only
`getClient` to prevent application DB access. Three passing integration tests:

* `getWorkerScanState`: latest success/failed, worker isolation, pending and
  processing, descending year/month, empty worker.
* `claimNextJob`: timestamp/id tie-break, NULLS LAST, source filtering,
  locked-row skipping, attempt/picked-at updates, no pending job, and
  already-claimed job refusal.
* `recordJobResult`: neither pending nor processing leftovers permit early
  completion; final success completes only its own run; success/failure and
  benefit counters, persisted failure reason, and missing queue IDs behave
  correctly with the new LIMIT 1 query.

The index migration's separate real-Postgres suite checks installation,
reruns, interrupted-build recovery, and schema-push/drift parity. Existing
enqueue batching remains unchanged. No end-to-end benefits scan, full
application concurrency simulation, FK cascade load, or production execution
plan is claimed by this benchmark. In particular, the performance harness
isolates queue SQL and does not time contention on the parent run-status row;
the actual-storage regression tests do execute those status updates.

## Reproduction

PostgreSQL `initdb`, `pg_ctl`, `createdb` must be on PATH; run as a non-root user.
Use a fresh, isolated cluster and dedicated database. The benchmark consumes
the shared project URL resolver but refuses non-loopback hosts, any database
except `wmb_queue_bench`, or execution without explicit opt-in. It creates
and drops only its own `wmb_bench_<pid>` schema.

```sh
scratch=$(mktemp -d /tmp/wmb-bench.XXXXXX)
initdb -D "$scratch/data" -A trust -U "$(whoami)" --no-locale
pg_ctl -D "$scratch/data" -l "$scratch/postgres.log" \
  -o "-h 127.0.0.1 -p 55432 -k $scratch" -w start
trap 'pg_ctl -D "$scratch/data" -m fast -w stop' EXIT
createdb -h 127.0.0.1 -p 55432 -U "$(whoami)" wmb_queue_bench
EXTERNAL_DATABASE_URL="postgres://$(whoami)@127.0.0.1:55432/wmb_queue_bench" \
  npx tsx scripts/dev/benchmark-wmb-queue.ts --allow-scratch-write
```

Optional `--rows` supports 20,000–5,000,000 rows in multiples of 10,000.
`--output` chooses the JSON output path (default:
`docs/wmb-queue-performance-evidence.json`). These benchmark-only options use
command-line flags, not application environment registrations.
Tests create their own socket-only temporary clusters
and never read an application connection URL:

```sh
WMB_QUEUE_STORAGE_PG=1 npx vitest run tests/wmb/wmb-queue-storage-postgres.test.ts
WMB_QUEUE_INDEX_PG=1 npx vitest run tests/wmb/wmb-queue-index-postgres.test.ts
npx vitest run tests/wmb/wmb-scan-queue-storage.test.ts
```

## Rollout and operational checks

Deploy migration 1198 with the storage existence-query change, not later.
It builds indexes concurrently outside a transaction, bounds lock/build
timeouts, verifies same-name definitions, retries invalid artifacts on rerun,
and restores session settings. A timeout is an explicit failed migration,
not permission to silently proceed missing indexes. Investigate blockers
before retrying; index creation still consumes CPU, I/O and disk.

After migration, confirm all three `pg_index.indisvalid` flags and run
`ANALYZE public.trust_wmb_scan_queue` when statistics need refreshing. On the
real deployment, compare EXPLAIN plans using representative worker/run IDs,
observe active-backlog/source skew and pool checkout separately from SQL
latency, and verify queue throughput plus worker-page request timing during
normal background processing. Do not run synthetic inserts on production.
Rollback the existence-query change first if indexes must be removed;
removing only the indexes can regress LIMIT 1 completion checks.
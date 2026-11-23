# Scheduling worker history query verification

## Decision

Replace the materialized assignment-history aggregate in
`server/storage/edls/available-workers-query.ts` with three correlated
`LEFT JOIN LATERAL` lookups, each returning at most one joined sheet status.
Reuse `edls_assignments_worker_id_ymd_idx`; no schema migration is needed.
The available-worker population, rating/industry joins, output columns, and
final ordering are unchanged. This is not directory-page scoping.

Each lookup joins crews and sheets **before** applying its limit. Cleared
assignments and missing related rows therefore cannot hide a farther valid
assignment. All sheet statuses, including trash, remain eligible. Comparisons
use `ea.ymd`, not `es.ymd`; prior uses `ea.ymd DESC, ea.id ASC`, current uses
`ea.id ASC`, and next uses `ea.ymd ASC, ea.id ASC`.

## Method

Compared the original compiled Drizzle query with a proposed lateral-query
version **before changing application code**. After implementation, repeated
the comparison using the actual new compiled query against the saved original.
Both rounds used PostgreSQL in development, isolated scratch tables, and the
same indexes as the application. No application records were changed.
The scratch schema and all its contents were rolled back.

Fixture:

- 202 workers; 201 contacts, leaving one missing-contact worker.
- 200 potentially populated workers, with every seventh inactive and every
  eleventh missing its population row; one contact-bearing worker without any
  history or population row.
- Optional ratings omitted for every third worker, including null and tied
  values among the remainder.
- Industry-specific statuses with sequences, a null sequence, and workers
  having only a different industry's status.
- 0, 30, 365, and 3,650 assignment days on **each** side of the reference day
  for 200 workers, including current-day rows when history is nonempty.
- Five sheets and twenty crews per assignment day (plus edge-case records).
  At the largest size this is 1,460,200 assignments, 36,510 sheets, and
  146,026 crews.
- Every nineteenth worker has only cleared assignments. Other histories
  include regular null crew IDs, nonexistent crew IDs, and crews whose sheet
  is missing. The deliberately unconstrained scratch foreign keys allow
  testing missing joins.
- All five sheet statuses occur. Base edge-case sheets deliberately have
  dates different from their assignments.

Deep-compared complete row arrays, including ordering, for all eight
industry/rating/includeInactive combinations at each size. Also compared all
eight combinations with a reference date before and after the entire history.
Finally removed only the scratch worker/day uniqueness index and inserted
same-day ties, including missing joins before valid rows. All eight variants
selected the lower assignment ID and returned the expected
`trash / request / draft` prior/current/next statuses. These ties cannot occur
under the current production uniqueness constraint, but the query retains the
original explicit tie breaks.

All **56** comparisons matched. Final focused tests also protect the
join-before-limit boundary, date/ID ordering, and all population/sort variants
without requiring a database.

## EXPLAIN (ANALYZE, BUFFERS)

Ran `ANALYZE` on the scratch tables after each load, then collected three
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` runs per query for the default active
population and for industry + rating + includeInactive. Times below are
medians in milliseconds from the final verification of the actual code.
These are local synthetic benchmarks, not production latency guarantees.

| Assignments | Default aggregate | Default nearest | Industry/rating/all aggregate | Industry/rating/all nearest |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0.264 | 1.157 | 0.686 | 1.422 |
| 12,200 | 12.745 | 3.561 | 10.664 | 3.458 |
| 146,200 | 145.678 | 6.382 | 129.330 | 6.484 |
| 1,460,200 | 2,281.224 | 11.364 | 1,542.696 | 10.158 |

Representative largest default-population plan:

- Original: materialized assignment statuses, `GroupAggregate` over joined
  history, and external sort work. Warm run: 1,328,194 shared buffer hits,
  8,788 temporary blocks read, 8,807 written.
- Replacement: three nested-loop left joins with `Limit`; worker/date index
  scans backward for prior, equality for current, forward for next.
  Prior/next use incremental sorts to preserve the ID tie break.
  Warm run: 7,655 shared buffer hits, no temporary blocks read or written.
- Prior and next assignment scans each returned an average of two candidate
  rows per worker, rather than materializing all joined history. The fixture
  includes all-cleared workers, so those scans additionally filtered an
  average of 211 rows per worker. Current-day scans returned one row per
  worker. The default population contained 156 workers.
- Largest industry/rating/all plan: temporary reads/writes fell from
  10,698/10,714 blocks to zero; warm shared buffer hits fell from 13,368 to
  7,005. This population contained 134 workers.

The lateral approach costs roughly one extra millisecond on an empty
history and can touch more cached buffers on short histories; it avoids the
history-sized aggregate and disk spill as history grows. It does **not**
promise a fixed number of index entries examined: long runs of cleared
assignments or missing joins must still be skipped, and incremental sorting
can inspect the next date group. No cached facts, counters, background jobs,
or additional indexes were introduced.

Raw compiled queries, execution plans, and the summary were retained locally
in the ignored `generated-artifacts/edls-nearest-assignment/` directory.
They are disposable verification outputs and are not application assets or
part of Git history.

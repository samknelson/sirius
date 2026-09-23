# Historical WMB lifecycle event backfill

This is an event-only tool. It does not scan eligibility, create coverage, queue
jobs, open COBRA cases, or notify anyone. Run on a database backup/rehearsal
first. Choose `--cutoff=YYYY-MM` as the **last month whose coverage history is
complete**. A run ending in that month stays open. The first missing month
following an earlier covered month is an *inferred* ending, not a failed scan.
Never choose a cutoff past an incomplete historical import.

Preview (default, read-only):

```sh
npx tsx scripts/oneoffs/backfill-wmb-events.ts --cutoff=2025-12 --limit=500
```

Inspect `byTypeBenefitMonth` for counts and up to three worker samples per
group. `created` in preview means *would create*; `removed` means *would
remove*. Starts and restarts follow existing denorm semantics: the first
covered month is both a start and a restart; each later coverage run has a
restart. The tool reconciles starts/restarts inside the cutoff using the same
coverage definitions as the denorm plugins. It never removes scan-confirmed
terminations or events outside the cutoff.

To verify a smaller slice, pass `--worker=ID` and/or `--benefit=ID`. After
checking the preview, add `--live` to write. Each worker is reconciled in a
transaction. A run processes at most `--limit` workers (default 500), returns
`nextAfterWorker` if more remain, and exits 2 when incomplete or any worker
failed. Continue with the **same cutoff and scope**, adding
`--after-worker=ID` using that cursor; only an exit 0 means the traversal
finished. After fixing a failure, rerun from before the failed worker or from
the beginning. Re-running is safe. If source coverage changes, rerun from the
beginning to remove obsolete inferred terminations, including workers whose
last coverage row was removed.

`created`, `unchanged`, `removed`, `skipped` (a scan event owns the key), and
`failed` are reported; group samples are bounded. Inferred terminations carry
`data.provenance = "coverage_inferred"` and an empty `failedPlugins` array.
Confirmed scan terminations take precedence; the COBRA reconciler ignores
inferred events. Inferred events remain visible to historical event queries.

Read-only validation queries (adjust month and benefit as appropriate):

```sql
SELECT event_type, benefit_id, year, month,
       data->>'provenance' AS provenance, count(*)
FROM trust_wmb_events
WHERE year <= 2025
GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4;

SELECT worker_id, benefit_id, year, month, data
FROM trust_wmb_events
WHERE event_type = 'terminate' AND data->>'provenance' = 'coverage_inferred'
ORDER BY worker_id, benefit_id, year, month LIMIT 100;
```
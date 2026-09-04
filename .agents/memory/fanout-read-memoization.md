---
name: Fan-out reads: memoize promises, not results
description: Why batching N per-item checks into one shared read context needs promise memoization, and why an existing result-cache does not dedupe concurrent misses.
---

# Fan-out reads: memoize the promise, not the result

When N items (months, workers, rows) each run the same multi-read check, run them
`Promise.all` against ONE shared read context whose loaders are **promise-memoized**
(`Map<key, Promise<T>>`, populated on first call). A cache that stores *results* (write
after `await`) does not help concurrent callers: all N miss at the same instant and each
repeats every read — same latency as before, N× the query load.

**Why:** the DC grant-config preview ran once per selected month, sequentially, and each
month re-read the worker, elections, benefit rows, policy chain and rules (~6–11 round trips
≈ 230 ms/month on Neon). Sharing a context made 12 months cost about one month. But the
policy resolver's own per-run cache stores results, so the concurrent months still fanned
out 12× on the policy/history/default-policy reads until those reads were memoized too.

**How to apply:**

- A read context is valid for reads only. A caller that WRITES between iterations (the
  real grant cascade writes hours per month) must use a fresh context per iteration; the
  batch/preview caller shares one. Same function, `context` as an optional last argument.
- Expose the reads as an injectable facade (defaulting to live storage) so shared helpers
  gain memoization without changing their other callers.
- `prefetch` = start the always-needed reads at construction with a detached `.catch`
  observer; the memoized promise still rejects for whoever actually awaits it.
- Verify with a per-read trace (start/end timestamps): the total should be the longest
  single dependency chain, and the read count should not grow with N.
- Same-name DB-backed test files that re-run a component's migrations in `beforeAll`
  (DC suites) race each other when several run in one vitest invocation (DDL deadlock, or
  a re-added CHECK failing on a sibling's fixture rows) — run them one file per invocation.

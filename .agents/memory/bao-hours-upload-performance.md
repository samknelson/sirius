---
name: BAO hours upload performance
description: Where feed-wizard upload time goes and the caching/batching invariants added to keep steps fast
---

Profiled (500-row synthetic upload, dev Neon): Process is dominated by per-row DB WRITES — hours upsert firing charge plugins (~2s/row), month reconciliation, work-status writes. Read-side steps were dominated by re-download/re-parse plus per-row lookups; those are now cached/batched:

- `feed.ts` caches parsed raw rows by FILE ID (module-level bounded Map). Safe because upload files are immutable — a re-upload creates a new files row. Column mapping is applied per call, so mapping changes need no invalidation. Cached arrays must be treated read-only.
- `storage.workers.getWorkersBySSNs(ssns)` bulk-resolves SSNs in one query (keys = normalized 9 digits). Feed process/preview/verify prefetch it; the process loop must add newly created workers to the map so duplicate SSNs later in the file resolve (matches old per-row behavior).
- gbhet RunContext caches employment-status/work-status option lists per run; withholding fund-account resolution memoized per wizard object (settled promise so failures rethrow identically per row).

**Why:** validate went 18.3s→0.25s, preview 40.2s→2.4s, verify 25.6s→6.7s; process only 996s→902s because charge-plugin execution per row dominates (parallelizing it was explicitly out of scope).

**How to apply:** any smoke test that stubs `getWorkerBySSN` on the storage singleton must ALSO stub `getWorkersBySSNs` or previews see every worker as new. `FEED_PROFILE=1` enables coarse step timing logs. Result-CSV generation needs the "private" filesystem in FILESYSTEMS; shell-run scripts without it log "Failed to generate results CSV" (non-fatal).

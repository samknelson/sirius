---
name: S1 log-notes immutable skip
description: Query-boundary exclusion of completed immutable rows + null-fingerprint-until-verified retry semantics in the log-notes loader
---

The log-notes loader excludes completed `smf:notes`/`raw` rows AT THE STAGED-PAGE SQL BOUNDARY (predicate mirrors JS `norm`/`sourceValue` shape handling; completion = id_map non-stub + consumed_fingerprint NOT NULL + current logic_version). `--force-reconcile` disables it.

**Why:** the ~500k Legacy Notes population is immutable after first successful import; re-reading/hashing/verifying it capped runs at ~22 rows/s.

**How to apply:**
- Any SQL mirror of a JS normalization must stay in lockstep (unit test pins the variants); a mis-read shape only falls through to the ordinary JS path because exclusion also requires a completed mapping.
- Deletion sweep must pass a `sourceSql` leg marking every staged immutable row as still-current, or query exclusion is mistaken for source deletion.
- New mappings are inserted with `fingerprint: null`; only batch verification advances fingerprints (`advanceFingerprints`). A failed initial import therefore stays retryable and is never frozen behind the skip. Rerun expectation is `unchanged + detail.immutableSkipped == first-run total` (audit doc 09 OP-3/N2 updated accordingly).
- Bulk persistence lives in `storage.notes.bulkReconcileForMigration` (per-chunk tx, set-based ownership/adoption/tag replacement, per-ref failures; chunk exception → whole chunk rejected retryably). Bench: `scripts/oneoffs/s1-log-notes-bench.ts` (~1,000 rows/s insert-heavy at 20k scale under 512 MB heap).
- Bench/oneoff scripts must not read `process.env` directly (env-registry lint): use CLI args and `getRawProcessEnv()` for the spawnSync passthrough.

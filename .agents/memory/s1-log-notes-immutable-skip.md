---
name: S1 log-notes immutable skip
description: Query-boundary exclusion of completed immutable rows and the retry/sweep invariants it forces
---

The log-notes loader excludes completed `smf:notes`/`raw` ("Legacy Notes") rows at the staged-page SQL boundary; `--force-reconcile` is the operator escape hatch.

**Why:** the dominant population is immutable after first successful import; re-reading/hashing/verifying it capped runs at ~22 rows/s.

**How to apply (invariants that must hold together):**
- The SQL predicate mirrors the JS normalization — keep them in lockstep (a pinned unit test covers the variants); exclusion also requires a completed mapping, so a mis-read shape only falls through to the JS path.
- The deletion sweep must mark every staged immutable row as still-current (sourceSql leg), or query exclusion is mistaken for source deletion.
- Mappings insert with a NULL fingerprint; only post-verification advances it — that is what keeps failed initial imports retryable behind the skip. Rerun expectation: `unchanged + immutableSkipped == first-run total`.
- Postgres gotcha baked into the bulk tag replace: `NOT (x = ANY(ARRAY[NULL]))` is NULL, so an empty desired set must be a true empty typed array or stale rows silently survive.

---
name: Live S1 count drift
description: Daily staging count policy for a changing real-S1 source versus final-freeze.
---

Daily node staging may accept live count movement only after two complete ordered identity scans agree on the same identity fingerprint/count and a post-scan source count agrees too. A moving identity set must retry only a bounded number of times, then fail before stale cleanup or loaders. Source surfaces without an equivalent identity contract remain strict even in daily mode. Final-freeze retains a strict stable-source consistency requirement under an operational write freeze.

**Why:** Exact zero drift is unattainable when count and extraction do not share a snapshot, but count bounds alone miss inserts beyond a captured shard boundary, lower-ID type corrections, and equal-count delete/insert churn. No S1 journal or snapshot transaction exists to close those gaps.

**How to apply:** Require an auditable, complete identity workset before deletion reconciliation or wet loading; never raise retry/concurrency limits to force a moving source through. Treat post-verification mutations as next-daily-run work. Do not weaken final-freeze: quiesce S1 for the entire stage/load window and require strict parity.
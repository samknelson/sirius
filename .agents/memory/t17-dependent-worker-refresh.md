---
name: T17 dependent-worker refresh
description: Why benefit-history must refresh dependent workers outside the span fingerprint fast path.
---

T17 dependent benefit spans must project `worker_id` from the live
relationship endpoint before every month-set diff. Rows carrying a migrated
relationship are migration-owned for stale-month deletion even when their
former worker was only a shell.

**Why:** Relationship reconciliation can replace a shell worker with the real
worker in place while preserving the relationship UUID. The S1 benefit span
and its fingerprint do not change, so a span-only fast path otherwise keeps
the deleted shell worker ID and every new month insert fails its worker foreign
key.

**How to apply:** Any future dependency-derived field cached in T17 scratch
must either participate in the consumed fingerprint or have an explicit
pre-diff refresh from its live authoritative S2 dependency. Do not require
`--force-reconcile` for ordinary dependency remaps.
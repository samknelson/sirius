---
name: Denorm event ordering race
description: Shared denorm invalidations must protect computation snapshots, including disabled processing and migration cleanup.
---

Keep concurrency protection in the shared denorm framework, not in individual plugins. Every source invalidation must participate, including hand-written stale upserts and migration cleanup. Disabling processing must not disable durable invalidation.

**Why:** serializing writes alone does not protect the earlier reads that produced them. A missed invalidation can leave an existing payload permanently incorrect; missing-row backfill will not repair it. A disabled config means paused processing, not permission to lose changes.

**How to apply:** use the shared invalidation and guarded apply contract for every writer. Benchmark bulk work at the actual source commit boundaries; one artificial scan-wide transaction conceals bookkeeping costs and does not prove partial-failure safety.

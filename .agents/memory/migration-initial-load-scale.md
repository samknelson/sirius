---
name: Migration initial-load scale
description: Fresh-target bookkeeping can dominate migration runtime despite successful incremental rehearsals.
---
Migration bookkeeping must batch writes as well as domain data. Validate fresh-target paths separately from already-populated rehearsal reruns.

**Why:** A production benefit-history run reached anchor creation only after millions of month rows were committed; sequential mapping writes made the fresh-target phase prohibitively slow. Incremental runs can conceal that cost because mappings already exist.

**How to apply:** Preserve first-wins mapping semantics and restart safety in bounded SQL batches. Do not infer the dominant production bottleneck from a progress rate alone: inspect both candidate selection and write round trips, and measure on the target before promising a runtime.
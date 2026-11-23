---
name: Bounded SQL enrichment
description: Keep earliest-per-worker detail joins bounded and measure empty-schedule cases as well as long schedules.
---

When narrowing a detailed list to one result per subject, bound the selected rows in a derived table before joining descriptive data. Do not assume an ID subquery in `WHERE` makes PostgreSQL perform those joins only for selected IDs.

**Why:** PostgreSQL reordered an earliest-assignment ID filter after several descriptive joins. A derived-table limit, safe because the selected IDs already contained at most one assignment per requested worker, prevented that reordering. Per-worker lateral lookups also did unexpectedly high work for workers with no matching future shift; a set-based earliest-per-worker selection performed better on the mixed fixture.

**How to apply:** Compare `EXPLAIN (ANALYZE, BUFFERS)` for populated, missing, cleared, and past-only schedules. Check intermediate descriptive-join row counts, buffer accesses, and transferred rows, not just elapsed time or final output cardinality. Keep date authority and ordering from the original read rather than silently substituting an indexed denormalized date.

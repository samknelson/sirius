---
name: jsonb adopt-compare key order
description: Idempotent upsert "unchanged" checks against a jsonb column need canonical stringify — Postgres reorders keys.
---

Postgres jsonb does NOT preserve object key order (keys come back sorted by
length/alpha). A loader/upsert that decides "adopted vs updated" by comparing
`JSON.stringify(existingRow.data)` with a freshly built object literal never
matches after the first write, so every rerun churns `updated` instead of
`adopted` (still converges, but the run report lies about idempotency and
rows get rewritten forever).

**Why:** hit in the S1 cardchecks loader — first run `created`, every rerun
reported `updated: N` until the comparison was made canonical.

**How to apply:** compare with a key-sorted stable stringify (recursive
`Object.keys(v).sort()`), or compare only scalar columns. Applies to any
"skip if unchanged" logic that round-trips a jsonb `data` column.

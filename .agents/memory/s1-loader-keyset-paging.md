---
name: S1 loader memory-bounding pattern
description: How the S1 history loaders stay memory-bounded at production volume, and pitfalls hit while paging them.
---

The S1 history loaders stream staged rows via keyset paging and do all existence/adoption/verify lookups as per-page batched IN-queries; the hours loader additionally orders its stream by worker so completed groups flush immediately.

**Why:** production volume (hundreds of thousands to millions of staged rows) blows memory / takes hours with whole-bundle loads and per-row lookups. Verified by a timed dry-run bench under a hard 512MB heap cap.

**How to apply:**
- New loaders must follow the page-scoped resolve → batched prefetch → write → batched verify shape; per-row storage *writes* stay (correctness boundary).
- When aggregation spans rows (grouping), order the stream by the group's leading key (expression index on the staging table if the key lives in jsonb) so groups become flushable — a plain nid-ordered stream keeps all groups resident.
- Cross-page dedupe can rely on re-querying the DB per page — earlier pages' writes are visible as existing rows, so page-local caches are safe.
- Pitfall: parameterized values inside `jsonb_build_object(${n})` via drizzle `db.execute` fail with "could not determine data type of parameter" on the Neon driver — add explicit `::int`/`::text` casts.

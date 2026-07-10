---
name: Options sequence ties break cross-surface ordering
description: Why duplicate `sequence` values on options_* tables cause config-page vs consumer ordering to disagree, and how to fix.
---

Unified-options `list()` orders rows by `ORDER BY asc(sequence)` with **no
tiebreak**, and the config page (GenericOptionsPage) then does a JS stable sort
on `sequence` only. So when several rows share the same `sequence` value, their
relative order is decided by unstable DB heap order.

Any *other* surface that orders the same options by `sequence` (e.g. the worker
list benefit-icon aggregation in `server/storage/workers.ts`, which joins to
`options_trust_benefit_type` and `ORDER BY bt.sequence`) will pick its own
tiebreak and disagree with the config page for the tied group.

**Rule:** ordering by `sequence` is only deterministic when sequences are unique.

**How to apply:** If a consumer's order disagrees with the config page for a
subset of options, check for duplicate `sequence` values first
(`SELECT sequence, count(*) ... GROUP BY sequence HAVING count(*)>1`). The fix is
to renumber the sequences to unique dense `0..N` **in the order the config page
currently shows them** (which is `list()` order), not to add a tiebreak to the
consumer — no deterministic tiebreak can reproduce the heap order the config page
happens to display. A storage-layer one-off (renumber via
`getOptionsStorage().update`) is the pattern; it is idempotent. Note this is a
per-database data fix, so it must be re-run against production after publishing.

---
name: Span→month sync via scratch table
description: Sync conversion pattern for loaders whose output is a derived set (one source span → N month rows)
---

**Rule:** when a loader's output is a DERIVED SET (one source span → N month
rows), sync conversion must diff a persisted desired set, not fingerprint
individual outputs: keep resolved spans in a per-loader scratch table under
`s1_staging` and let the desired-vs-actual diff drive the writes.

**Why:** a source fingerprint can only say "this span changed" — it cannot
retract *previously* derived rows after a span is shortened, retargeted, or
deleted without last-known desired state. The diff also self-heals
out-of-band S2 drift, which is what makes stamping fingerprints at
scratch-upsert time (instead of post-verify) safe.

**How to apply:**
- Rejected rows keep their last-good scratch rows (one bad daily extract must
  not delete a member's coverage); sweep scratch rows whose source left
  staging, refusing to sweep when staging is empty (likely an accident).
- Provenance anchors that downstream consumers dereference need a liveness
  pass every run — repoint to a surviving row, don't reject.
- Delete only within migration scope and the projection horizon; count, don't
  delete, beyond it (early warning that another writer is active).
- Scratch resolutions go stale after id_map repairs and fingerprints won't
  budge — that's what `--force-reconcile` is for; a resolved field tracking a
  live dependency must instead be re-checked explicitly every run.

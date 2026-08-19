---
name: Span→month sync via scratch table
description: Converting derived-set loaders (span → N month rows) to reconciling syncs — desired-set scratch table, fingerprint placement, anchor liveness, horizon rules
---

**Rule:** when a loader's output is a DERIVED SET (one source span → N month
rows), sync conversion must diff the desired set, not fingerprint individual
outputs: persist resolved spans in a per-loader scratch table under
`s1_staging` (nid PK, resolved target ids, `consumed_fingerprint`,
`logic_version`), expand + diff set-based in SQL (UNLOGGED run-scoped tables,
not TEMP — pool sessions differ; `seq bigserial` for keyset-paged apply), and
apply via per-row suppressed storage writes.

**Why:** an id_map fingerprint can only say "this source changed" — it cannot
retract the *previous* derived rows after a span is shortened/retargeted/
deleted without last-known desired state. A global desired-vs-actual diff also
self-heals any out-of-band S2 drift for free, which is what makes stamping the
fingerprint at scratch-UPSERT time (instead of post-verify) safe: the diff,
not the fingerprint, drives writes.

**How to apply:**
- Rejected rows keep their last-good scratch rows (stale-but-safe coverage —
  one bad daily extract must not delete a member's months); count them.
- Sweep scratch rows whose nid left staging, guarded by staged>0 (empty
  staging + non-empty scratch = refuse, likely staging accident).
- Provenance anchors (id_map entry → first month row) need a dedicated pass
  every run: repoint dangling anchors to a surviving row, retire when the span
  is gone, create for new spans. Consumers (T18-style) need a LIVE row id —
  repoint, don't reject.
- Deletion scope: only migration-covered parents (non-stub id_map) at months
  ≤ the horizon; count-not-delete beyond it (early warning that another
  writer is active). Any S2 writer producing rows in that scope (benefits
  scan) must stay off during dual-run or the sweep eats its rows.
- Open-end horizon defaults to the current LA month for dailies; the parity
  harness must use the loader's exact horizon; a later horizon adds only the
  delta, a closed span retracts its projection.
- After any id_map repair/remap the scratch resolutions are stale and the
  fingerprints won't budge — that's what `--force-reconcile` is for. If one
  resolved field must track a live dependency (election→employer fallback),
  re-check it explicitly every run instead.
- Dev prereq: per-type id_map liveness — with zero live relation mappings
  every dependent span rejects; re-run the upstream loader after a regen.

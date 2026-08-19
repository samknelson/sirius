---
name: S1 sync fingerprints & deletion sweeps
description: Gotchas in the dual-run sync foundation — consumed fingerprints, fast-path skips, deletion sweeps, and dev id_map repair patterns.
---

# S1 sync fingerprints & deletion sweeps

**Fast-path skips must still feed intra-run caches.**
**Why:** load-options resolves member-status industries via `industryByTid`, filled while processing industry terms. When industries are unchanged and fast-skipped, the cache must be filled FROM THE MAPPING on skip, or worker-ms terms fail industry resolution only on sync re-runs.
**How to apply:** any converted loader whose later rows depend on earlier rows' resolutions must populate those lookup maps in its skip branch too.

**Fingerprint lifecycle:** `putMapping` stamps `consumed_fingerprint` + `logic_version` on INSERT only (the S2 write just landed and verify re-reads the whole table). Pre-existing mappings advance via `advanceFingerprints` only AFTER the loader's verify pass, so failed writes stay retryable. `remapMapping` (policy retitle → retarget) intentionally does NOT advance — the next run re-verifies.

**Widening `MappingInfo` breaks unconverted loaders.** Loaders that build local `Map<number, MappingInfo>` literals (`.set(nid, { s2Id, stub, ... })`) fail tsc when the type gains fields. Grep for such literals across all loaders when changing idmap types (load-hours, load-relationships hit this).

**Dev smoke backfills hashes by RE-UPSERTING staged rows read back from dev staging — never by restaging** (regenerating synthetic staging invalidates id_map; see s1-regen-idmap-staleness).

**Dev id_map corruption modes** (all pre-existing, surfaced by the sync smoke):
- mappings whose staged source vanished (old regen leftovers) → drop;
- mappings whose S2 target row was deleted out-of-band → drop (loader hard-fails "repair id_map");
- CROSS-TYPE mappings (a payment-type tid mapped to an industry row uuid) → liveness checks must be per-options-type, never a cross-type id union — the uuid is "live" in the wrong table.
Also: a numeric siriusId is only "retired" relative to its OWN type — regen tid ranges overlap across vocabs, so membership in the global staged-tid set proves nothing.

**Repair for "name-matches row which already carries siriusId X — resolve manually":** declare identity in id_map (putMapping term→row); the loader's matched path then heals the stale siriusId itself (S1 wins). Don't clear siriusIds by SQL.

**Sweep semantics:** report-only policy re-emits `deleted_in_s1` findings on EVERY run and blocks (exit 1) until resolved or `--allow-findings deleted_in_s1` per run; deactivate stamps `s1_deleted_at` so later sweeps count `alreadyHandled`; stubs are never swept.

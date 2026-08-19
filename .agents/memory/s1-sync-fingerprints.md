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

**Cross-entity dependency fingerprints (cardchecks pattern — reuse in future conversions).** Dependent-record fingerprints embed the resolved dependency's IDENTITY (mapped s2 id), never its content; the dependency entity gets its own composite fingerprint over its row hash + resolved pointer-node hashes, with sentinels for unresolvable pointers (`missing:<nid>`, `staged-unhashed:<nid>`, null = not configured).
**Why:** identity-not-content keeps a dependency edit from stampeding all dependents, and it moves dependency-pass rejects behind the fast path — they fire only when the dependency actually reprocesses, so steady-state rerun reject COUNTS drop while allow-lists stay valid (expected-shape docs must say so).
**How to apply:** any converted loader with a resolver/definition side-entity; document the rerun reject-count change in RUNBOOK §5/§4 or operators will think a trap vanished.

**Report-only retention sweeps relabel + enrich.** Domains where source deletion may not propagate (signed authorizations, member designations): run the standard sweep, then relabel the finding kind per domain (`pending_retention`, `source_worker_missing`) and enrich with current S2 state (per-status aggregates). Never stamp `s1_deleted_at` (it would suppress re-emission as `alreadyHandled`), never delete/revoke; findings re-fire every run, `--allow-findings` is per-run only, stop-the-line for the final freeze until a fund ruling.

**Sync smoke pitfalls:** (1) seeded fixtures can saturate the domain invariant (every seeded worker×definition pair already signed) — transition smokes need a fallback picker over real staged+mapped rows free of conflicting S2 state; (2) seeded nid ranges mix mapped rows with unmapped reject fixtures — version-flip probes must select their target FROM id_map, never by nid arithmetic.

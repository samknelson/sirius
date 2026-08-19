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

**Fingerprints capture SOURCE CONTENT, not the resolution environment.** A row loaded while a referenced entity was unmapped keeps its degraded resolution (e.g. `referenceType='s1-unknown'`) even after the mapping appears later — the source hash never changed, so the fast path skips it forever.
**Why:** reference resolution happens at load time via id_map; nothing re-runs it on unchanged rows.
**How to apply:** loader ORDER is a correctness constraint under sync (referenced entities' loaders run before referrers'). For rows that STORE a degraded resolution marker, give the referrer loader a heal pre-pass: each run, re-check only the degraded set and clear fingerprints for rows whose target now resolves — the standard update path then rewrites them (bounded work; permanently-dangling rows are never re-written). `--force-reconcile` remains the blunt fallback after mass re-mapping events.

**A storage delete that cascades across loader-owned rows must invalidate the OTHER loader's id_map mappings, drop-before-delete.** Otherwise the cascaded rows keep matching fingerprints and the other loader fast-skips their still-staged sources forever (permanent holes only `--force-reconcile` heals).
**Why:** payment deletes cascade referencing ledger rows; the ledger loader's unchanged path never checks row existence (that's the point of the fast path).
**How to apply:** in the sweeping loader, look up cascade victims' identity keys and delete their mappings BEFORE the storage delete — mapping-gone-but-row-present converges via adopt; row-gone-but-mapping-present never converges. Count non-own-entity cascade victims for triage.

**Hard-delete sweep policies self-heal regen/id_map fallout on their first converged run:** stale mappings whose nids left staging sweep their S2 rows; staged rows under new nids create fresh. Big create+delete pairs on a first post-regen run are convergence, not a bug.

**Aggregation loaders can't fingerprint per-row:** convergence uses a sidecar key registry (stamp every written key per flush; keys NOT restamped this run = stale rows to delete), gated on the run's own verify passing (a broken run must never delete). An adoption flag seeds the sidecar once on a pre-sync target; forgetting it is safe (no cleanup, no damage).

**Cross-entity dependency fingerprints (cardchecks pattern — reuse in future conversions).** Dependent-record fingerprints embed the resolved dependency's IDENTITY (mapped s2 id), never its content; the dependency entity gets its own composite fingerprint over its row hash + resolved pointer-node hashes, with sentinels for unresolvable pointers (`missing:<nid>`, `staged-unhashed:<nid>`, null = not configured).
**Why:** identity-not-content keeps a dependency edit from stampeding all dependents, and it moves dependency-pass rejects behind the fast path — they fire only when the dependency actually reprocesses, so steady-state rerun reject COUNTS drop while allow-lists stay valid (expected-shape docs must say so).
**How to apply:** any converted loader with a resolver/definition side-entity; document the rerun reject-count change in RUNBOOK §5/§4 or operators will think a trap vanished.

**Report-only retention sweeps relabel + enrich.** Domains where source deletion may not propagate (signed authorizations, member designations): run the standard sweep, then relabel the finding kind per domain (`pending_retention`, `source_worker_missing`) and enrich with current S2 state (per-status aggregates). Never stamp `s1_deleted_at` (it would suppress re-emission as `alreadyHandled`), never delete/revoke; findings re-fire every run, `--allow-findings` is per-run only, stop-the-line for the final freeze until a fund ruling.

**Sync smoke pitfalls:** (1) seeded fixtures can saturate the domain invariant (every seeded worker×definition pair already signed) — transition smokes need a fallback picker over real staged+mapped rows free of conflicting S2 state; (2) seeded nid ranges mix mapped rows with unmapped reject fixtures — version-flip probes must select their target FROM id_map, never by nid arithmetic.

**Entity-loader reconcile patterns** (people/employer/config conversion):
- *Anchor entities for grouped children:* when S1 has no per-child node (member-status tids on a worker, policy/rate history entries inside shop JSON), reconcile through ONE per-parent id_map anchor (s1_id = parent nid) whose fingerprint covers the resolved child set. An empty child set reconciles to empty but KEEPS the anchor; only a staged-parent delete sweeps it.
- *Resolution-outcome fingerprints:* when the S2 write depends on cross-entity resolution (employer↔contact link targets; call-log handler→worker→contact), fingerprint the RESOLVED outcome (id or a stable unresolved sentinel), not just staged bytes, and resolve BEFORE classifying — else a repaired mapping or repointed dependency never converges (batch resolution per page so the fast path still skips writes).
- *Owned-set reconcile needs a provenance stamp:* collection rows the loader owns carry `data.source='s1-migration'`; add/remove only within that owned subset so app-created rows survive.
- *Shared-child sweeps AND retargets:* when several S1 sources share one S2 row (packet-tag comms), sweeping one source removes only its mapping — the row is deleted only when the LAST source vanishes. Same discipline on retarget: an in-place rewrite of the shared row is only safe when the changed source is its SOLE live mapping (and no row already exists for the new target); otherwise MOVE the changed source's mapping (adopt the target's existing row, else create one) and leave the shared row to its remaining sources — an in-place write hijacks it while the other sources' fingerprints stay clean and fast-skip forever. A row left with zero mappings must be deleted inline; sweeps never see unmapped rows.
- *Date-freeze:* approximate dates derived from node `changed` are set at create and FROZEN on update — `changed` moves on every S1 edit and would churn the field forever.
- *Sweep-skip guard:* a sweep scoped by vocabulary/terms must abort with a blocking finding when the vocabulary is absent on the target (dev), never silently sweep everything.

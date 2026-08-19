---
name: S1 one-command sync orchestrator
description: Envelope-contract gating, child lock escape, findings allowance layers, and dev seed ordering for the daily/final-freeze sync command
---

The one-command sync (scripts/s1-migration/sync.ts + sync-config.ts) runs the whole loader fleet under one advisory lock and gates on machine-readable results.

- **Child lock escape**: the orchestrator holds the migration advisory lock; child loaders that also acquire it must skip their own acquisition when `S1_SYNC_LOCK_HELD=1` is in the env. Any new loader/seed that takes the lock needs this escape or the fleet deadlocks/refuses.
- **Envelope contract, not log scraping**: children write their standard result JSON to `S1_RESULT_JSON_PATH`; the orchestrator validates presence, shape, loader name, dryRun/force echo, and that the emitted logicVersion matches sync-config's pinned version. A transform fix without a config version bump (or vice versa) fails the run by design.
- **Two allowance layers for report-only findings**: profile-level `dailyAllowedFindings` = acknowledged-for-daily but STILL block final-freeze; per-step `StepPolicy.allowFindings` = config-RULED structural kinds (e.g. dev packet-tags `sweep_skipped_no_keep_tag_terms`) that are also exempt from final-freeze blocking. Ruled ≠ unresolved. Unknown kinds fail closed in validateSyncConfig.
- **Once a loader gains the standard reject gate, its previously tolerated annotation-family rejects need explicit per-profile allowance** (dev vs production lists differ; production allows more classes like `worker_gender_unresolved`, `sirius_id_assigned`).
- **Dev seeds are dependency-ordered mid-fleet**: `postStageSeeds[].afterStep` (e.g. beneficiary fakes need id_map from contacts-workers). They cannot run right after stage on a fresh target; restage sweeps them, so they re-run every sync.

**Why:** the dual-run month needs every gate machine-checkable and fail-closed; human log reading does not scale to 20 loaders daily.
**How to apply:** adding a fleet step = add FLEET entry + per-profile StepPolicy + (if it locks) the lock escape + envelope emission; adding a finding kind = KNOWN_FINDING_KINDS + explicit ruling comment wherever allowed.

---
name: Denorm event ordering race
description: Framework-wide race — denorm registry runs compute() before applyComputed's lock, so a stale snapshot can overwrite newer facts and be marked ok.
---

The denorm registry runs `plugin.compute(entityId)` BEFORE `applyComputed` acquires the status-row lock. Rapid same-entity mutations can compute divergent snapshots; the older one can win the lock last, overwrite the newer facts, and mark the row `ok` — so the stale sweep never repairs it.

**Why:** the status-row lock serializes writes, not the reads that produced them. Shared by every denorm plugin; not plugin-specific.

**How to apply:** never attempt a per-plugin fix in a new denorm plugin — follow the existing convention. A real fix belongs in the registry: serialize/coalesce per (plugin, config, entity), compute inside the applyComputed transaction after taking the status row, or add a monotonic revision guard.

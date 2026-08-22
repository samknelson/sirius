---
name: Stale worker SID collisions can be duplicate rows
description: How to distinguish an unmapped worker rekey from a duplicate-worker consolidation during S1 migration repair.
---

If a stale S2 worker's reviewed S1 identity is already mapped through `id_map` to a different canonical S2 worker, and that canonical row owns the current staged S1 SID, treat the stale row as a duplicate. Preserve and reconcile its dependent history onto the canonical row, then remove the empty stale row. Do not add a Legacy NID or repoint the authoritative mapping to the stale duplicate.

**Why:** A SID ownership collision can look like a missing-identity problem, but a matching canonical mapping proves the person already exists in S2. Rekeying the stale duplicate would collide with the canonical worker and could attach benefit history to the wrong row; deleting first would cascade historical data.

**How to apply:** Resolve each reviewed S1 NID through staging, compare its mapped worker and current SID, inventory every stale-row dependency and worker-key uniqueness constraint, resolve collisions explicitly, and verify no references remain before deletion. Handle source-missing workers separately with explicit approval for their cascade impact.
---
name: Stale worker SID collisions can be duplicate rows
description: How to distinguish an unmapped worker rekey from a duplicate-worker consolidation during S1 migration repair.
---

If a stale S2 worker's reviewed S1 identity is already mapped through `id_map` to a different canonical S2 worker, and that canonical row owns the current staged S1 SID, treat the stale row as a duplicate. Preserve and reconcile its dependent history onto the canonical row, then remove the empty stale row. Do not add a Legacy NID or repoint the authoritative mapping to the stale duplicate.

**Why:** A SID ownership collision can look like a missing-identity problem, but a matching canonical mapping proves the person already exists in S2. Rekeying the stale duplicate would collide with the canonical worker and could attach benefit history to the wrong row; deleting first would cascade historical data.

**How to apply:** Resolve each reviewed S1 NID through staging, compare its mapped worker and current SID, inventory every stale-row dependency and worker-key uniqueness constraint, resolve collisions explicitly, and verify no references remain before deletion. Handle source-missing workers separately with explicit approval for their cascade impact.

For colliding benefit-month rows, derive the surviving `source_relation_id` from current staged benefit spans using the loader's month-expansion and lowest-source-NID rules. Exclude source records the loader would reject before expansion; they are reject-policy work, not competing month authority. Preserve a stable live WMB row ID, repoint migration anchors and non-FK references, then apply the derived provenance.

**Why:** Duplicate workers can each carry plausible relationship provenance, and some months may correctly resolve to a third relation or subscriber (`NULL`) provenance. Choosing stale or canonical metadata wholesale silently corrupts benefit history; treating rejected spans as authority blocks valid repairs.

**How to apply:** Reconstruct authority from staged fields and mappings, classify every collision month, separately inventory rejected/unresolved spans, and gate the transaction on complete coverage plus explicit counts for stale/canonical/third provenance.

A rollback-only execution against the real rehearsal target confirmed that this guarded consolidation path reaches its complete post-state with all reviewed dependency and provenance counts satisfied.

**Why:** Static analysis alone cannot prove that the live target still matches the dependency inventory or that every uniqueness constraint survives the ordered merge.

**How to apply:** Keep the rollback rehearsal as the final gate. Produce or run a commit variant only after it returns the explicit ready marker and every count matches the reviewed plan.

The guarded repair was subsequently committed on the real rehearsal target with every reviewed count satisfied.

**Why:** Future rehearsal work must not assume the stale duplicates or approved source-missing row still exist, or rerun the destructive repair.

**How to apply:** Treat the duplicate consolidation as completed on that target and continue from the contacts/workers loader and remaining fleet gates.
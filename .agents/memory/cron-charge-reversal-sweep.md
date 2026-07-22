---
name: Cron charge reversal sweep scope
description: Cron-billing charge plugins must sweep previously billed entities, not just currently-active ones, to post offsetting adjustments.
---

Rule: a CRON-trigger charge plugin that must reverse charges when coverage is canceled cannot iterate only the "active" entity list — canceled/closed entities drop out of that list and their orphaned charges are never seen. Union the active list with the distinct referenceIds already billed by the config (ledger entries by config + referenceType), then reconcile each month's NET total (base + adjustments) to the expected amount (0 for uncovered months).

**Why:** BAO COBRA billing: closed cases leave `listElectedActiveCases`, so a sweep over that list alone would leave charges on canceled elections forever. Net-total reconcile keeps re-runs from double-charging or double-reversing.

**How to apply:** in any scheduled billing plugin with cancellation semantics, use `storage.ledger.entries.listReferenceIdsByConfigAndType(configId, referenceType)` to build the sweep set; group entries by a `billingMonth`-style metadata key; only warn (don't reverse) when a still-active entity has inconsistent data.

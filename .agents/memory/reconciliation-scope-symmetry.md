---
name: Reconciliation scope symmetry
description: Scoped trigger reconciliation must restrict reversals to the same subject set as pricing.
---
Immediate event reconciliation and full historical reconciliation must apply the same scope to both desired-state computation and orphan reversals.

**Why:** Scoping only the pricing loop leaves unrelated historical charges absent from the desired set; an unrestricted orphan sweep then wrongly reverses them.

**How to apply:** Test that an unrelated posted balance and its entry count remain unchanged after an event, not merely that unrelated source records were not queried.
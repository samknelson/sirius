---
name: Wizard side-effect rows need reuse + ownership flag
description: Pattern for wizard steps that create real DB rows (e.g. worker relations) as side effects
---

Wizard steps that create "real records on purpose" (rows that persist even if the draft is abandoned) will pile up duplicates across repeated drafts unless BOTH of these exist:

1. **Storage-level duplicate guard** — the storage create/update rejects a semantically duplicate row (for worker relations: same directed pair + same relation type + overlapping date window; direction matters because asymmetric types like parent/child mean different things each way; update passes its own id as excludeId).
2. **Wizard reuse + ownership flag** — the wizard "add" first searches for an existing active matching row and reuses it, recording `createdByWizard` on the draft entry; "remove" only deletes rows the wizard created (`createdByWizard !== false`, so legacy entries without the flag keep old delete behavior).

**Why:** repeated enrollment drafts created 3 duplicate spouse relations between the same two workers; deleting on remove without ownership would have destroyed a pre-existing real relation.

**How to apply:** any new wizard step that persists rows outside the wizard's own data must follow the reuse+flag pattern, and the underlying storage module should enforce the uniqueness invariant itself.

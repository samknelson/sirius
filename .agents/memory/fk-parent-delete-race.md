---
name: FK parent delete vs concurrent child insert
description: How to safely delete a row referenced by an ON DELETE SET NULL FK without silently nulling links created mid-cleanup
---
Rule: count-then-delete on a parent row with an ON DELETE SET NULL FK is racy — a child insert between the count and the delete succeeds and then gets its FK silently NULLed.
**Why:** discovered in the contact-type options cleanup; review rejected the unlocked version.
**How to apply:** wrap verify+delete in ONE transaction with SELECT ... FOR UPDATE on the parent row. FK inserts take KEY SHARE on the parent, so they block on the FOR UPDATE and fail 23503 after commit. Smoke pattern: scripts/s1-migration/dev/smoke-contact-type-cleanup.ts.

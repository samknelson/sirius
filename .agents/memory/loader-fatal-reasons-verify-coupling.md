---
name: Loader FATAL_REASONS ↔ verify-pass coupling
description: S1 loaders' verify pass skips only rejects listed in FATAL_REASONS; a missing reason inflates verifyFailures (exit 1) or hides mis-verification.
---

Every S1 loader gates its verify pass with `rejects.hasAnyIn(nid, FATAL_REASONS)`. Any row-skipping reject reason that is NOT in that list makes the verify pass treat the rejected row as "should have loaded" → phantom verifyFailures (or, worse in payments' expectations style, silent mis-verify).

**Why:** Found twice — currency_mismatch missing from load-payments, then bad_changed_epoch missing from ALL four epoch-using loaders (relationships, elections, benefit-history, member-statuses).

**How to apply:** when adding a `rejects.add("new_reason", ...)` + `continue` to any loader row loop, add the reason to that loader's FATAL_REASONS in the same edit. Reject-class smoke tests must be DELTA-based against a baseline run — the shared dev DB carries pre-existing staged rejects (reltype_unresolved, payment_type_term_unmapped...). Pattern: scripts/oneoffs/s1-reject-classes-smoke.ts.

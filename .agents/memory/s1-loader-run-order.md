---
name: S1 loader run-order dependency
description: Ledger reference resolution depends on id_map entries written by earlier loaders; wrong order silently yields s1-unknown.
---

The t18 ledger loader resolves reference nids via id_map lookups per entity
(payment, wb/payperiod, employer, ...). Mappings only exist after the loader
that owns that entity has run. Running t18 before t19-payments (or without
the WMB loader) types nearly every entry `s1-unknown` even though the
referenced nodes are all staged.

**Why:** rehearsal 2026-08 ran t18 → t19; 99.98% of s1-import entries came
out `s1-unknown`, initially looking like deleted-node drift. Attribution
query (join s1-unknown reference nids to staged bundles) showed 100% staged
→ pure ordering artifact.

**How to apply:** production run order must load referenced entities
(payments, WMB) BEFORE the ledger; the adopt path does NOT re-resolve
references on rerun, so ordering is not self-healing. Gate with a post-load
linkage counter (dangling payment refs). Triage recipe lives in
docs/s1-migration/08-ledger-payment-reconciliation.md §9.

## Money order is payments → hours → ledger (permanent)
Hours must load before ledger: the hours loader owns the pay-period→monthly-hours crosswalk that ledger reference resolution depends on. Migrated billing history is a preserved fact — reconcile against it with adjustments, never delete it, and date historical corrections to the affected work month, not the run date.
**Why:** the reverse order left references unresolved and caused double-billing on the first post-migration save.

## Employer-upload history exception authority

The user approved the inspected unresolved employer-upload cohort as allowed
rejects after source investigation. Their suggestion that these were stale
test files was tentative, not a verified data classification.

**Why:** approval to omit known unresolvable history must not become permission
to ignore new source or destination failures or invent employer/month links.

**How to apply:** preserve the approved source identities and observed reasons
in the migration evidence; count the rejects and re-evaluate them on each run.
Do not turn a repaired relationship into a permanent exclusion. The approved
disposition is documented in `docs/s1-migration/employer-wizard-history.md`.

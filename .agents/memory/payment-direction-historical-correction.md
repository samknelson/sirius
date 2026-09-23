---
name: Payment direction historical correction
description: Accounting policy for changing the effect of posted payment types and repairing legacy allocations.
---

Treat a payment type's ledger effect as a historical accounting decision, independent of its financial/adjustment category. A type already used by cleared payments must not change direction through an ordinary editor update. Correct legacy entries only after a reviewed, exact source-and-entry snapshot, using the owning payment allocation plugin and retaining stable entry identities; never sign-flip the ledger directly or run unrelated payment plugins.

**Why:** Some records historically called “payments” were intended as charges, and cleared allocations had the opposite sign. A configuration-only migration makes future accounting correct but leaves historical balances wrong until a deliberate repair. A direct SQL sign update would bypass allocation identity, provenance, and verification, while replaying every payment plugin could alter bespoke entries.

**How to apply:** When introducing another charge-directed type or repairing old records, preview the target database's candidate payments and derived entries, obtain an exact fingerprint, run the scoped repair with that fingerprint, then verify the resulting balances and retained entry identities. Do not run an unreviewed production repair.
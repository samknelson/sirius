---
name: Fingerprint fast paths need target-state proof
description: Prevent consumed source fingerprints from masking missing reconciled child rows after target restoration or truncation.
---

For loaders that reconcile a set of target child rows from one source record, a matching
source fingerprint is not sufficient to skip the record. The fast path must cheaply prove
the desired target set still exists and has no stale migration-owned members; otherwise it
must fall through to ordinary reconciliation.

**Why:** Source-consumption bookkeeping can survive while target business rows are emptied
or restored from a different snapshot. Trusting the fingerprint alone then reports every
source record as unchanged, writes nothing, and can falsely pass verification if fast-path
records are excluded from the verify set.

**How to apply:** Use the fingerprint to avoid transformation work, not as proof of target
existence. Validate the complete owned child set before skipping, or include every desired
record in final verification and invalidate/reconcile missing targets. A logic-version bump
repairs existing stale mappings once, but it does not replace the ongoing target-state check.
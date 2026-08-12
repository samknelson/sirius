---
name: Charge plugin stale-entry replacement
description: Why corrected charge-plugin entries must be updated in place, not delete + re-emit
---

Rule: when a charge plugin replaces a stale ledger entry (idempotent re-run with corrected amount), it must UPDATE the existing row in place via `storage.ledger.entries.update` and return no transactions — never delete the row and emit a replacement transaction.

**Why:** the shared executor writes plugin transactions *after* `execute` returns and its per-entry insert is soft-fail (errors are logged, not thrown). Delete-then-emit can permanently lose the worker's entry when the later insert fails. Flagged by completion code review on financial data.

**How to apply:** in any charge plugin's stale-entry path: identical amount → skip (`skippedDuplicate`); differing amount → in-place update + `updated` notification; missing row on update (concurrent change) → fail loudly. Also: idempotency keys for weekly/periodic imports should be `(configId, workerId, periodYmd)` — never include wizardId/rowIndex, since re-uploads get new wizard ids and would duplicate.

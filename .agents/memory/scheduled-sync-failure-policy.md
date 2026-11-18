---
name: Scheduled sync failure policy
description: Daily continuation is not permission to accept failed source records.
---

Scheduled daily S1 sync should attempt the remaining loaders after a loader fails, retaining overall FAIL and the original reasons. Manual and final-freeze defaults remain unchanged.

**Why:** The user explicitly chose continuation with failure reporting, not relaxed reject rules or success-with-warnings.

**How to apply:** Do not add reject allowances to make scheduled runs green. Startup, lock, write-fence, and staging failures still stop execution; downstream prerequisites remain required. Production behavior changes only after a separately authorized immutable migration-image and scheduler task-definition rollout.

Treat verification assertions, rejected payments, and balance drift as separate
triage inventories; equal failure totals across runs do not establish the same
assertion or record, and payment rejects alone do not prove the cause of drift.

**Why:** The supplied daily evidence did not persist the failed assertion or
the balance detail; inferring a repair from those counts would exceed the
operator's authorization.

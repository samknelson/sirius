---
name: Whole-statement checkout
description: Net credit allocation and conservative handling of unknown pending payment targets.
---

Whole-statement checkout applies net account credits oldest-statement-first and
shows the adjustment before confirmation. A net quote alone is insufficient:
credits must have a snapshotted source period and be transferred in the same
settlement transaction, or invoices retain misleading residual balances.
Unattributed credits block checkout until attribution is resolved. Statement selections exclude
unstatemented debt; full balance includes it. A pending attempt without a known
allocation blocks new checkout rather than guessing its target.

**Why:** Account balances can differ from the sum of positive statement balances.
Simply capping a payer's selection at the account balance can silently redirect
money or reserve the same statement twice while unrelated debt remains. Test
the resulting invoice balances after posting, not only quote and allocation arrays.

**How to apply:** Preserve the shared quote semantics across browser, locked
attempt creation, and settlement. Historical unallocated attempts need explicit
reconciliation, not an invented allocation. Method-management permission governs
saving/managing methods, not an otherwise authorized payer's use of an existing
method.
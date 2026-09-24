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

For a pending statement payment, treat the immutable quote's statement due,
cash allocation, credit attribution and period as one proof set. An increase
in that same period can be offered only after the earlier cash and committed
credits are deducted, with all reservations reconciled to the account pending
total. Incomplete snapshots cannot prove a new increment, even when the
current account balance minus pending payments looks payable.

**Why:** Reserving a whole period hides later charges, while subtracting only
the pending cash without checking its historical credit attribution can collect
the old statement twice. The provider may settle attempts in either order.

**How to apply:** Keep the quote snapshot and allocation immutable at attempt
creation; use the same shared calculator for preview and locked confirmation.
Never infer a missing historical snapshot from today's invoice balance.

New checkout collection is intentionally one-off; reusable methods belong to
the separately authorized setup flow. Historical attempts that requested
saving must remain replayable and settle under their original recorded intent.

**Why:** Mixing reuse consent into a purchase made it unclear whether the payer
was adding a reusable method or merely paying once. Rejecting old replays
would strand already-created provider intents and pending ACH reservations.

**How to apply:** Keep checkout's new-method requests without future-use setup,
while maintaining existing saved-method use and legacy attempt reconciliation.
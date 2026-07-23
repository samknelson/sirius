---
name: Payments post to ledger only via allocation config
description: Why a cleared payment can leave an account balance unchanged
---

A ledger payment row (even status "cleared") does NOT affect any balance by
itself. Balances sum ledger entries only. Credit entries for payments are
posted by the `payment-simple-allocation` charge plugin, which requires an
enabled charge plugin config whose `account` column matches the payment's
account. No config for the account = payment silently never hits the ledger.

**Why:** Debugging "I paid but the balance didn't change" — the payment was
cleared but no allocation config existed for the account.

**How to apply:** When seeding a new billable account for testing, also seed
an enabled `payment-simple-allocation` charge config pointed at that account.
For payments made before the config existed, replay them through
`triggerPaymentChargePlugins(payment)` (server/modules/ledger/payments.ts) —
it is idempotent per allocation key.

---
name: Test-mode provider entry order
description: Guard provider-side customer creation and avoid leaking provider entry secrets in HTTP previews.
---

For Stripe test-only verification, validate **both** keys before the first provider call, including customer lookup or creation. Also treat SetupIntent and checkout client secrets as bearer-like secrets in HTTP response-preview logging.

**Why:** The saved-method flow can create a provider customer before calling the setup-session plugin. A guard only inside setup-session is too late. A real test setup also exposed its client secret in the generic response preview until that field was redacted.

**How to apply:** Any new payment-provider entry point should guard credentials before `ensureCustomer` or equivalent, and test the redacted logging output as well as the response returned to the authorized caller.

New-method checkout has a deliberate two-phase prerequisite check: the first phase must permit a customer that will be created after credential validation; the actual provider payment creation must require that customer.

**Why:** Requiring a customer in the earlier phase makes an opted-in first checkout impossible, while moving customer creation ahead of credential validation could enter a live provider before the test-only refusal.

**How to apply:** Preserve both boundaries when reusing provider preflight checks, including the configuration recheck inside the checkout transaction. Deferring customer existence never defers credentials, amount, or payment-type validation.
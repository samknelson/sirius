---
name: Test-mode provider entry order
description: Guard provider-side customer creation and avoid leaking provider entry secrets in HTTP previews.
---

For Stripe test-only verification, validate **both** keys before the first provider call, including customer lookup or creation. Also treat SetupIntent and checkout client secrets as bearer-like secrets in HTTP response-preview logging.

**Why:** The saved-method flow can create a provider customer before calling the setup-session plugin. A guard only inside setup-session is too late. A real test setup also exposed its client secret in the generic response preview until that field was redacted.

**How to apply:** Any new payment-provider entry point should guard credentials before `ensureCustomer` or equivalent, and test the redacted logging output as well as the response returned to the authorized caller.
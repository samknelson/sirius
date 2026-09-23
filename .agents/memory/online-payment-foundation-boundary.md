---
name: Online payment rollout boundary
description: Preserve the existing attempt lifecycle and historical unknowns during checkout expansion.
---

Evolve existing online attempts and event receipts rather than introducing checkout sessions as a second lifecycle. Keep historical payer identity and consent unknown; only proven relationships may be backfilled.

**Why:** Worker Stripe charging already existed before the approved checkout plan was written. A parallel lifecycle would abandon active provider references and pending ACH recovery.

**How to apply:** New worker/employer checkout must reuse attempts, distinguish receipt from completed effects, and preserve the original webhook route. New account settings default disabled; foundation deployment alone must not authorize live charging.

An attempt without a stored provider reference is not proof that no charge
exists: the process may have crashed after provider creation and before saving
the response. Reissue only through the SAME provider idempotency contract used
for that attempt; older attempts with a different creation contract must stay
reserved for investigation rather than be recreated through the new contract.

**Why:** Expiring or reissuing ambiguous intents can let the payer submit a
second charge while the first is still capable of settling.

**How to apply:** Treat no-reference recovery as a provider operation, not a
local clock-based cleanup. Cancel or verify provider state before releasing
funds; keep in-flight bank transfers reserved regardless of their age.
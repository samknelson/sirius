---
name: Online payment rollout boundary
description: Preserve the existing attempt lifecycle and historical unknowns during checkout expansion.
---

Evolve existing online attempts and event receipts rather than introducing checkout sessions as a second lifecycle. Keep historical payer identity and consent unknown; only proven relationships may be backfilled.

**Why:** Worker Stripe charging already existed before the approved checkout plan was written. A parallel lifecycle would abandon active provider references and pending ACH recovery.

**How to apply:** New worker/employer checkout must reuse attempts, distinguish receipt from completed effects, and preserve the original webhook route. New account settings default disabled; foundation deployment alone must not authorize live charging.
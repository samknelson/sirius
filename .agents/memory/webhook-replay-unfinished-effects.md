---
name: Webhook replay must retry unfinished effects
description: Why duplicate provider-event receipt cannot short-circuit an incomplete internal transition.
---

A duplicate provider event means the event was received before; it does not prove every internal side effect completed. If the provider state is terminal but its internal effect is still unclaimed or unfinished, replay must retry that effect through the same idempotent claim.

**Why:** Recording the provider event before ledger posting is necessary for replay protection, but a crash between those operations otherwise makes every provider retry return early and leaves confirmed funds permanently unposted.

**How to apply:** Separate event-receipt deduplication from effect-completion idempotency. Monotonic state checks still reject stale transitions, while a replay of the current terminal event may resume an unfinished effect guarded by its own atomic claim.
---
name: Payment reconciliation ownership
description: Why a payment save must not reconcile both inline and through its saved event
---

A payment save has one billing owner. When a route awaits reconciliation to
return notifications, its saved event is observational for billing, not another
instruction to execute. Event-only saves still need their normal consumer.

**Why:** invoking the same plugins inline and from a fire-and-forget event can
race on the same missing allocation entry. Sequential idempotency checks do not
prove concurrent safety. A lock around the saving route does not serialize an
independent event consumer.

**How to apply:** keep receipt edits and awaited reconciliation serialized
together; publish observational events after commit, outside the old ambient
transaction. Preserve event-only consumers without adding a second execution
for saves already handled inline.

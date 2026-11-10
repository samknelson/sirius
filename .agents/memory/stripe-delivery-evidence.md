---
name: Stripe delivery evidence
description: Distinguishing settled intents, event ingestion, and actual webhook subscriptions.
---

Do not interpret Stripe's `pending_webhooks: 0` as delivery success without
checking the matching account's endpoint/subscription inventory.

**Why:** A successful bank intent can have a succeeded event and zero pending
deliveries when no destination subscribes to payment events. The legacy v1
webhook endpoint list can be empty even though v2 event destinations exist.
This project's operator supplied a real configured destination that the legacy
listing missed; its thin account notifications were not payment subscriptions.
Later reconciliation can clear the local payment without any webhook receipt.

**How to apply:** Correlate the complete intent through the local gateway,
compare provider state and the local inbox, and inspect endpoints read-only.
Check BOTH v1 webhook endpoints and v2 core event destinations, including
payload type and subscribed events. An existing URL is not proof that
PaymentIntent updates are subscribed; an empty v1 list is not proof of no URL.
Separate observations from inferences about which reconciliation path ran.
Do not create an endpoint or run broad recovery to investigate one payment.

---
name: Checkout abandonment boundary
description: Why explicit checkout abandonment is narrower than a generic unfinished payment
---

Offer payer-initiated abandonment only while the payment provider still reports its initial, unconfirmed `created` state. An apparent `requires_action` may already represent a card authentication challenge or other confirmation underway. Keep unknown-reference, processing and confirmed attempts reserved rather than inferring safety from local age or page navigation.

**Why:** A checkout can reserve funds before card entry, but local status is not authoritative about whether the provider started confirming it. Releasing a reservation on a local guess can invite a second charge. Concurrent webhook settlement also needs to be serialized against a provider cancellation request, not just against its final local write.

**How to apply:** Recovery actions must be creator-scoped, retrieve provider state, then rely on the provider's canceled response and the shared evidence settlement. Hold the attempt lock across the local recheck and provider request so a webhook cannot advance it to processing between the check and cancellation.
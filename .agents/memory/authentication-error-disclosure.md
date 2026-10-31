---
name: Authentication error disclosure
description: Public account-refusal messages must distinguish verified identity from access permission.
---

An inactive-account explanation is appropriate after identity verification succeeds; it must not be described as a failed SAML signature or assertion. Keep other account-linkage and provisioning details administrator-only.

**Why:** A production account refusal was mistaken for an identity-provider configuration failure because the generic SAML error hid the inactive status and replaced its diagnostic reference. The owner explicitly requested a clear inactive-account message. That does not authorize revealing whether an arbitrary unauthenticated email exists.

**How to apply:** Carry a verified account-denial outcome separately from protocol verification errors, preserve its original administrator-log reference, and render fixed messages rather than provider payloads or query-supplied prose. Apply the same identity-verification prerequisite when extending this behavior to another provider.

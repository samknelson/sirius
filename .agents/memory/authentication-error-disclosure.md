---
name: Authentication error disclosure
description: Public account-refusal messages must distinguish verified identity from access permission.
---

An inactive-account explanation is appropriate after identity verification succeeds; it must not be described as a failed SAML signature or assertion. Keep other account-linkage and provisioning details administrator-only.

**Why:** A production account refusal was mistaken for an identity-provider configuration failure because the generic SAML error hid the inactive status and replaced its diagnostic reference. The owner explicitly requested a clear inactive-account message. That does not authorize revealing whether an arbitrary unauthenticated email exists.

**How to apply:** Carry a verified account-denial outcome separately from protocol verification errors, preserve its original administrator-log reference, and render fixed messages rather than provider payloads or query-supplied prose. Apply the same identity-verification prerequisite when extending this behavior to another provider.

Clerk's unlinked identities must still be able to finish worker registration and reach sign-in to switch accounts. Do not treat every verified-but-unlinked identity as a terminal enrollment failure.

**Why:** Clerk sign-up returns to the application's registration page before the local account link exists. A broad refusal redirect prevents that page from completing the link.

**How to apply:** Keep document and registration routes reachable; suppress generic current-user refusal navigation on enrollment/sign-in pages, while still explaining a verified inactive-account refusal.

---
name: Contract Chat product direction
description: Vendor-neutral contract chat and the intended first provider.
---

Contract Chat is intended to be a thin wrapper around a web service for chatting about a specific contract. Foray is the first provider, but additional vendors may be added.

**Why:** The user explicitly separated the application functionality from the initial vendor implementation, rather than making contract chat Foray-specific.

**How to apply:** Keep chat functionality vendor-neutral and put provider-specific behavior behind a contract chat webclient vendor. Scope each stage to the user's approved request rather than assuming vendor work also authorizes a chat UI.

## Confirmed experience boundaries

Contract Chat access permits every contract in the explicitly selected vendor's
catalog. There is no Sirius contract-ID mapping or user-specific catalog filter.
Provider roles are `staff` for effective users with staff permission, `member`
for everyone else; no steward mapping.

Temporary history belongs in browser session storage, not Express sessions,
application storage, transcript logs or a persistent conversation database.
Foray processes submitted conversation context externally under its own retention
policy; clearing the browser conversation cannot erase vendor copies.

**Why:** These were explicit product and privacy decisions for the chat experience,
not gaps to fill with per-user contract mapping or permanent storage.

**How to apply:** Preserve the thin provider-neutral boundary when extending chat.
Any proposal to change access granularity, provider role mapping, or retention
requires a new product decision rather than an implicit implementation choice.

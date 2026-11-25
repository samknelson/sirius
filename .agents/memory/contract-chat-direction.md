---
name: Contract Chat product direction
description: Vendor-neutral contract chat and the intended first provider.
---

Contract Chat is intended to be a thin wrapper around a web service for chatting about a specific contract. Foray is the first provider, but additional vendors may be added.

**Why:** The user explicitly separated the application functionality from the initial vendor implementation, rather than making contract chat Foray-specific.

**How to apply:** Keep future chat functionality vendor-neutral and put provider-specific behavior behind a contract chat webclient vendor. The initial request was component declarations only, not permission to implement chat or vendor calls.

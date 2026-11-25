---
name: Login return scope
description: Product boundary for returning visitors after authentication.
---

Login return restores only the application page pathname, within the same tab.
It intentionally does not restore query strings, fragments, form state, filters,
scroll position, or credentials. Keep provider state and callback protocols
unchanged when extending this behavior.

**Why:** The requested feature is page navigation, not state restoration; the
pathname-only boundary keeps credentials and private page state out of login
links and the pending return location.

**How to apply:** Reuse the per-tab client handoff across providers. Automatic
session expiry should preserve the interrupted page; intentional sign-out must
discard the pending return location. Route permissions still decide access.

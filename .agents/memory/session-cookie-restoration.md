---
name: Session cookie restoration
description: Changing express-session cookie defaults does not upgrade stored sessions.
---

Apply cookie security policy to restored sessions as well as new-session defaults.

**Why:** express-session reconstructs a stored session's Cookie using its saved options, replacing the configured defaults. Adding SameSite to the middleware options alone leaves existing sessions on their previous policy.

**How to apply:** when tightening cookie policy, test both newly issued cookies and restoration of a legacy session without the new attribute. Preserve the session ID unless rotation is explicitly required. The browser receives changed attributes when a cookie is next issued; enforce request-side protection immediately rather than waiting for every browser's cookie to update.

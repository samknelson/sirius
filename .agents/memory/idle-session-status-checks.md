---
name: Idle-session status checks
description: Distinguishes deadline observation from activity that extends an authenticated session.
---

Polling or reading the current inactivity deadline must not itself count as authenticated activity. Only normal authenticated work or an explicit continue-session action may renew the deadline.

**Why:** If a deadline-status request rolls the session forward, the warning mechanism keeps every open browser session alive indefinitely and defeats server-side inactivity enforcement.

**How to apply:** Any new session-status, countdown, or monitoring endpoint must use the read-only session path. Keep the server deadline authoritative and make deliberate continuation use the activity-recording path.
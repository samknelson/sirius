---
name: Socket session authority
description: Why long-lived private sockets need both persisted authority generations and read-only session validation.
---

Long-lived private sockets must validate the persisted authorizing session, not just a remembered user ID or a process-local logout event. Keep an authority generation stable through ordinary renewal, but change it when the owning or masqueraded identity changes.

**Why:** Separate server processes do not share local invalidation callbacks. Comparing only the current identity misses an away-and-back masquerade transition and can reauthorize an old socket. Changing generations on all saves instead breaks ordinary signed-in activity.

**How to apply:** Use local invalidation for prompt disconnects and fresh persisted reads before private delivery or acknowledgements for cross-process enforcement. Read outside the caller's transaction. Socket observation and pongs must never renew inactivity deadlines. Preserve independent sessions of the same user and the no-generation baseline of unchanged legacy sessions.

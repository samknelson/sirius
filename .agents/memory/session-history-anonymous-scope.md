---
name: Anonymous session history
description: Product scope for future session-history capture, beyond signed-in login events.
---

Session history is intended to support anonymous sessions, not only successful user logins.

**Why:** The owner explicitly chose support for anonymous sessions when deciding the history record's user association.

**How to apply:** When designing capture, distinguish a session existing from a user signing in. Do not assume every historical event has an authenticated user or silently discard anonymous events.

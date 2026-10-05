---
name: Anonymous session history
description: Product scope and the owner's no-logging/no-metadata constraint for session history.
---

Session history is intended to support anonymous sessions, not only successful user logins.

**Why:** The owner explicitly chose support for anonymous sessions when deciding the history record's user association.

**How to apply:** When designing capture, distinguish a session existing from a user signing in. Do not assume every historical event has an authenticated user or silently discard anonymous events.

All runtime history-table access must use its dedicated storage layer, with neither storage logging nor entity metadata.

**Why:** The owner explicitly required this separation; history observations must not produce another audit/history record or touch the associated user's provenance.

**How to apply:** Preserve this rule when adding future history reads, writes, or maintenance. Existing live-session logging is a different concern and is not subject to this exclusion.

---
name: Permission-dependent public response caching
description: Cache rules for public endpoints that conditionally enrich their response for authorized signed-in viewers.
---

A public endpoint that adds fields based on the viewer's cookie or access policy must return `Cache-Control: private, no-store` and `Vary: Cookie`. Its browser query cache must also distinguish the current viewer identity.

**Why:** Without both layers, an authenticated representation can be reused for an anonymous or different viewer, exposing fields that server authorization intentionally omitted for them.

**How to apply:** Use this whenever an otherwise public response conditionally includes administrative links, internal identifiers, or other signed-in-only data. Keep authorization server-side and omit protected fields on denial or evaluator failure.
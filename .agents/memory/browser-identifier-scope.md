---
name: Browser identifier scope
description: Owner-defined boundary for persistent browser-profile identifiers and lazy key initialization.
---

A browser identifier is a copyable profile label, never a credential, verified physical device, or trusted-device authentication signal. Keep it independent of account/session lifecycle and session-history enablement.

**Why:** The owner requested a recognition primitive only, not recognition, associations, alerts, or new-IP notification changes.

**How to apply:** Future recognition features need their own scope decision. Do not automatically persist the identifier in session history or add it to public responses, session payloads, or broad event envelopes.

Use the existing variable write operations and refresh hook for lazy signing-key persistence. An in-process initialization promise and unique-conflict reread are sufficient; do not add distributed coordination, new storage methods, or logging-protection work to this initialization.

**Why:** The owner explicitly chose the existing variable path's normal behavior and excluded locking and audit/redaction changes.

**How to apply:** Preserve maintenance/read-only restrictions, cache only a successfully resolved persisted key, retry failed initialization later, and require all instances to restart for explicit rotation.

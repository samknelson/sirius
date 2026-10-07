---
name: Browser identifier scope
description: Owner-defined boundary for persistent browser-profile identifiers and lazy key initialization.
---

A browser identifier is a copyable profile label, never a credential, verified physical device, or trusted-device authentication signal. Keep it independent of account/session lifecycle and session-history enablement.

**Why:** The owner requested a recognition primitive, not recognition, associations, alerts, or new-IP notification changes. They subsequently authorized retaining the verified identifier in session history, explicitly without surfacing it in the UX.

**How to apply:** Session-history persistence is in scope, but remains backend-only: retain only the verified UUID, not the signed cookie envelope, and do not infer historical identifiers. Future recognition features need their own scope decision. Do not add the identifier to the history UX, public responses, live-session payloads, or broad event envelopes.

Use the existing variable write operations and refresh hook for lazy signing-key persistence. An in-process initialization promise and unique-conflict reread are sufficient; do not add distributed coordination, new storage methods, or logging-protection work to this initialization.

**Why:** The owner explicitly chose the existing variable path's normal behavior and excluded locking and audit/redaction changes.

**How to apply:** Preserve maintenance/read-only restrictions, cache only a successfully resolved persisted key, retry failed initialization later, and require all instances to restart for explicit rotation.

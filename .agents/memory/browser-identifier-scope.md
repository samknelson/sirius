---
name: Browser identifier scope
description: Owner-defined boundary for persistent browser-profile identifiers and lazy key initialization.
---

A browser identifier is a copyable profile label, never a credential, verified physical device, or trusted-device authentication signal. Keep it independent of account/session lifecycle and session-history enablement.

**Why:** The owner initially requested a recognition primitive only. They subsequently authorized retaining the verified identifier in session history without surfacing it in the UX, then expanding the existing new-IP sign-in notifier to alert on a new IP or a new browser-profile identifier and include supplied User-Agent details.

**How to apply:** Session-history persistence and comparison for unusual-sign-in alerts are in scope: retain only the verified UUID, not the signed cookie envelope, and do not infer historical identifiers. User-Agent is descriptive text, not device identity. Other recognition or trusted-device features need their own scope decision. Do not add the UUID to the history UX, public responses, notification tokens/messages, live-session payloads, or broad event envelopes; descriptive User-Agent text and classification results can support messaging.

Use the existing variable write operations and refresh hook for lazy signing-key persistence. An in-process initialization promise and unique-conflict reread are sufficient; do not add distributed coordination, new storage methods, or logging-protection work to this initialization.

**Why:** The owner explicitly chose the existing variable path's normal behavior and excluded locking and audit/redaction changes.

**How to apply:** Preserve maintenance/read-only restrictions, cache only a successfully resolved persisted key, retry failed initialization later, and require all instances to restart for explicit rotation.

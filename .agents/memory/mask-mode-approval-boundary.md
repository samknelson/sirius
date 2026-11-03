---
name: Mask Mode scope and approval boundary
description: User requirements for recording mode and the distinction between an audit and implementation approval.
---

Mask Mode must be audited and explicitly approved before implementation. First names remain visible; first-name aliasing is outside the requested initial version. Full original surnames, SSNs and approved sensitive display identifiers must not reach the browser while enabled; CSS or client-only formatting is insufficient.

**Why:** The user records training against live S2 data and explicitly required an audit-first stop before any masking behavior is added. They asked for a session-local recording convenience, not a claim of comprehensive PHI de-identification.

**How to apply:** Treat an accepted/completed exposure audit as documentation approval only, not permission to implement. Present unsafe free-text/document/public-link limitations for approval rather than silently claiming field masking protects them. Proposed policies in task documentation remain proposals until explicitly approved.

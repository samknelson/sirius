---
name: Masquerade effective-actor convention
description: Who counts as "the user" while masquerading — request context, notifications, and audit logs
---

**Rule:** While masquerading, the masqueraded (target) user is the effective actor *everywhere* — request context userId/userEmail, event-notifier self-suppression, and storage audit-log user_id/user_email. The real session user appears only as provenance: `originalUserId/originalUserEmail` on the request context, and `meta.masqueradedBy {userId,userEmail}` in audit-log JSONB.

**Why:** User explicitly directed this (July 2026): audit logs must attribute to the masqueraded user, with the real user only in metadata. Earlier bug: self-suppression keyed off the real user and silently dropped notifications addressed to them while masquerading.

**How to apply:** Resolve users via the canonical `getEffectiveUser` helper (masquerade module) — never re-derive from session claims. Note: the request-context middleware must import it dynamically because the masquerade module imports request-context (static import = cycle). Any new actor-sensitive surface (logs, notifications, attribution) uses the effective user + separate provenance field.

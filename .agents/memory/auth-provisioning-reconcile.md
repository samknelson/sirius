---
name: Auth provisioning & SAML role reconciliation
description: Design of auth_settings variable, provisioning helper, and provider-managed role provenance
---
- Auth settings live in ONE `variables` row (`auth_settings`), zod-validated via the variable registry AND a dedicated PUT /api/admin/auth-settings that adds role-existence validation. No plugin-config framework (explicit user decision).
- Provider-managed role provenance = `authIdentities.metadata.managedRoleIds` (no user_roles column). Rule: only record a role as managed if the user did NOT already hold it; revoke only listed managed roles.
- **Why:** avoids schema migration; protects locally assigned roles. Known gap: local grant AFTER provider-managed grant is indistinguishable (single user_roles row) — a follow-up task exists to model grant sources.
- Provisioning (`maybeProvisionUser`) creates user+identity in runInTransaction; on 23505 re-reads the winning identity by provider/externalId and continues only if it matches. Role grants catch 23505 (not in a tx, so catch is safe).
- SAML attributes pass through in-memory only — never persisted on user/identity (PII).

## Full authentication diagnostics

Keep full assertions and their mapping explanations together in the debug-gated,
admin-only capture. Correlate through metadata identifiers, not entity/host log
bindings.

**Why:** Per-entity log endpoints can be available to staff with less access than
the admin System Logs viewer. Binding a raw assertion capture to a user or host
could expose it through those endpoints.

**How to apply:** Keep raw diagnostic payloads out of ordinary role-change audit
entries and their entity-linked history. Diagnostic correlation must not broaden
who can read the assertion.

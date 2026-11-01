---
name: Authentication and session decisions
description: Index of provisioning, authority, cookie, and public authentication-error constraints.
---

- [Provisioning and role reconciliation](auth-provisioning-reconcile.md) — preserve locally held roles when reconciling provider-managed roles.
- [Login email identity](login-email-identity.md) — duplicate login accounts require explicit operator resolution, never automatic account merging.
- [Idle-session status](idle-session-status-checks.md) — observing the deadline must not renew activity.
- [Configured external auth](configured-external-auth-fail-closed.md) — unavailable configured verification must fail closed.
- [SPA entry credentials](spa-entry-url-credentials.md) — remove credentials before bootstrap and never retain them in caches.
- [Cookie restoration](session-cookie-restoration.md) — saved cookie options override new session defaults.
- [Socket authority](socket-session-authority.md) — persisted generations enforce identity changes across processes.
- [Account deactivation](account-deactivation-authority.md) — reactivation must not revive old sessions or accept stale saves.
- [Error disclosure](authentication-error-disclosure.md) — inactive-account explanations require verified identity.

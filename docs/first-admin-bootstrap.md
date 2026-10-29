# First administrator provisioning

An effective, nonblank `LOCAL_AUTH_EMAIL` disables public first-admin bootstrap.
`GET /api/bootstrap/needed` returns `{"needed":false}` and
`POST /api/bootstrap` returns 403 without provisioning any role or user.
Submitting the configured email is not an exception.

This guard is independent of whether `LOCAL_AUTH_PASSWORD_HASH` is present or
valid, local authentication is enabled, or the configured administrator was
successfully reconciled. Fix incomplete operator configuration rather than
expecting the public first-run screen to recover it.

The existing local-admin reconciler remains responsible for the account.
Normal login and SSO account provisioning are unchanged. The guard reads the
effective email on each request through the normal environment registry;
account reconciliation still runs at boot. Deployment precedence and released
values follow the registry's existing rules.

The first-run UI follows the status endpoint. When bootstrap is unavailable,
direct navigation to `/bootstrap` redirects to `/login`.

**Scope:** deployments without an effective `LOCAL_AUTH_EMAIL` retain the
existing unauthenticated first-admin flow when their users table is empty.
This conditional protection does not make that unconfigured flow safe to expose
to untrusted clients. Once any user exists, public bootstrap remains forbidden.

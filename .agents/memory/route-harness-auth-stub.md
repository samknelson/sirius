---
name: E2E route harness auth stub
description: How to exercise admin-gated Express routes in a standalone tsx script without a real session
---

Pattern for oneoff scripts that mount a route module on a bare express app and hit it with fetch (see `scripts/oneoffs/verify-file-browser-routes.ts`):

- Init like `scripts/oneoffs/verify-edls-view-policy.ts`: `loadComponentCache()`, `initializePermissions()`, `initAccessControl(...)`, plus any service init (e.g. `initFileSystems`).
- The fake auth middleware must set `req.user = { claims: { sub: user.id }, dbUser: user }`. `buildContext` requires `claims`, and `resolveDbUser` short-circuits on the `dbUser` cache — a bare user object or claims-only yields 403 "Authentication required".
- Pick a real admin user from the dev DB by probing `storage.users.userHasPermission(id, "admin")`.
- Also `import "@shared/access-policies/loader"`. Without it the registry is
  empty and EVERY check answers `granted:false, "Modular policy not found: <id>"`
  — which reads like a real gate denial (empty lists, 403s) rather than a missing
  import, and sends you debugging the feature instead of the harness.

**Why:** requireAccess policies resolve the DB user through auth-identity lookup unless `dbUser` is pre-cached; stubbing anything less silently fails authz, not authn.

**How to apply:** any time a task needs authenticated e2e coverage of routes without a browser session.

Also: multer (`upload.single`) must come AFTER auth/authz middleware on upload routes, or unauthenticated callers can force 100MB in-memory buffering pre-rejection.

Shortcut for vitest route harnesses: setting `req.session = { masqueradeUserId: id }` plus `req.user = { claims: { sub: id }, dbUser: user }` makes `buildContext` take the masquerade path (`storage.getUser`), which needs only `initAccessControl(...)` — no policy loader import — as long as requireAccess itself is stubbed (see tests/sitespecific/bao-dc-routes.test.ts).

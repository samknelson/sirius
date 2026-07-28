---
name: E2E route harness auth stub
description: How to exercise admin-gated Express routes in a standalone tsx script without a real session
---

Pattern for oneoff scripts that mount a route module on a bare express app and hit it with fetch (see `scripts/oneoffs/verify-file-browser-routes.ts`):

- Init like `scripts/oneoffs/verify-edls-view-policy.ts`: `loadComponentCache()`, `initializePermissions()`, `initAccessControl(...)`, plus any service init (e.g. `initFileSystems`).
- The fake auth middleware must set `req.user = { claims: { sub: user.id }, dbUser: user }`. `buildContext` requires `claims`, and `resolveDbUser` short-circuits on the `dbUser` cache — a bare user object or claims-only yields 403 "Authentication required".
- Pick a real admin user from the dev DB by probing `storage.users.userHasPermission(id, "admin")`.

**Why:** requireAccess policies resolve the DB user through auth-identity lookup unless `dbUser` is pre-cached; stubbing anything less silently fails authz, not authn.

**How to apply:** any time a task needs authenticated e2e coverage of routes without a browser session.

Also: multer (`upload.single`) must come AFTER auth/authz middleware on upload routes, or unauthenticated callers can force 100MB in-memory buffering pre-rejection.

---
name: Employer literal routes vs /:id capture
description: New literal /api/employers/* routes must be registered in server/routes.ts before its /:id, or they 404 as "Employer not found".
---

New literal (non-param) `/api/employers/<word>` GET routes must be registered in
`server/routes.ts` immediately after `/api/employers/counts` and BEFORE
`/api/employers/:id` — not in the `server/modules/employers/` module.

**Why:** `server/routes.ts` is registered before the employers feature module, and
it defines its own `/api/employers/:id` handler. Express matches by registration
order, so a path like `/api/employers/contact-indicators` is captured by that
`:id` route (param = "contact-indicators") and returns 404 "Employer not found".
A correctly-written route placed only in the module is dead code. (`/counts`
works precisely because routes.ts has its own `/counts` before its `/:id`.)

**How to apply:** Add the literal route in routes.ts between the `/counts` and
`/:id` handlers. Keep it storage-layer compliant — call a `storage.*` method
(e.g. `storage.employerContacts.*`) rather than copying the legacy `/counts`
inline `sql`/`getClient` pattern, which is pre-existing tech debt, not a model.

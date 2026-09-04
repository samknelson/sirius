---
name: Dev curl auth shortcut
description: How to hit authenticated API routes from the shell in dev, and the component-enable restart gotcha.
---

In the dev environment the local email/password provider is the DEFAULT auth provider (Okta is prod). To exercise authenticated/admin API routes with curl:

1. `curl -c jar -X POST http://127.0.0.1:5000/api/auth/local/login -H 'Content-Type: application/json' -d '{"email":"<seeded admin email>","password":"$INITIAL_ADMIN_PASSWORD"}'` — iterate every user holding a local credential (auth_identities.provider_type='local' with a password_hash) and try login until one succeeds — the seeded-admin account is NOT guaranteed to be the first-created user.
2. Reuse the cookie jar (`-b jar`) for subsequent requests.

**Why:** avoids spinning up the Playwright tester for plain API verification; Okta cannot be curl-driven.

**How to apply:**
- Enabling a component by editing the `components` row in `variables` via SQL does NOT take effect until the app restarts — enabled components are cached at boot. Expect `component_disabled` errors until then.
- Boot takes ~25s under tsx; early curls get Express default 404s ("Cannot GET ...") that look like missing routes. Wait for "Application fully initialized" before concluding routes are unregistered.
- Server code changes are NOT hot-reloaded (tsx runs without --watch); only the Vite client HMRs. Restart the workflow after server edits.
- The break-glass admin does NOT accept `INITIAL_ADMIN_PASSWORD`, and no seeded local user did either (2026-09). For UI/Playwright verification, create a throwaway local user with a known password (via the storage layer, in the roles the flow needs), hand the tester that login, and delete the user and its identity/roles afterwards.

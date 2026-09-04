---
name: Dev UI verification login
description: How to get an authenticated browser/API session in the dev workspace for e2e verification when no known user password exists.
---

# Getting a signed-in session for dev verification

**Rule:** the `INITIAL_ADMIN_PASSWORD` secret is NOT a working login — nothing in
the server reads it. The seeded local admin's password comes from
`LOCAL_AUTH_PASSWORD_HASH` (a bcrypt hash; the plaintext is unknowable), so no
existing account can be logged into by an agent.

**How to apply:** create a throwaway local account, verify, then delete it.
- Rows: `users` (account_status 'active'), `auth_identities`
  (provider_type 'local', external_id = email lower-cased, password_hash), and
  `user_roles` pointing at the role that grants `admin` (or a narrower role).
- Generate the hash with `npx tsx scripts/oneoffs/generate-password-hash.ts '<pw>'`
  — it appends `AUTH_LOCAL_PEPPER` when one is configured, so never hash by hand.
- Login is `POST /api/auth/local/login` `{email,password}` (cookie session); the
  SPA form is `/login`. Hand the same throwaway credentials to the testing
  subagent for browser checks (the Screenshot tool is unauthenticated and only
  ever shows the sign-in page).
- Failed local logins are flood-limited (10 per email+IP per 15 min) — stop
  guessing after one 401.
- Cleanup order: rows that RESTRICT on the user (e.g. BAO cases assigned to it)
  first, then user_roles / auth_identities / users. Remove any temp password file.
- The first browser load after a restart can take 60–120 s while Vite builds
  the module graph; a tester's "blank /login" is that cold start, not a bug.

**Why:** a first verification attempt burned time trying the admin secret
against the seeded admin (401), and unauthenticated screenshots can't reach any
staff page.

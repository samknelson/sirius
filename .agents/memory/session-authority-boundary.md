---
name: Local session is the auth authority
description: Provider access-token expiry must not log out an active session; refresh outcomes have defined paths.
---
The persisted Sirius session (express-session + StorageSessionStore, rolling cookies) is the authoritative login lifetime.

**Rules:**
- An expired provider access token with NO refresh capability lets the request proceed (token is unused outside auth) — never 401 on that alone.
- Successful refresh must be persisted to the session explicitly (rotated refresh tokens survive instances) before continuing the request.
- Only revocation-class OAuth rejection (invalid_grant etc. → provider refreshToken returns null) follows the reauth path: logout + session destroy + 401 `{code:"reauth_required"}`.
- A THROWN refresh error is transient (network, temporarily_unavailable, server_error): the request proceeds, session preserved, refresh retried later. Never treat a thrown error as revocation.
- If the post-refresh session save fails (after one retry), respond 503 — never continue with an unpersisted rotated refresh token and never log the user out for it.
- Never log token values.
- `rolling: true` on the session middleware is what keeps browser-cookie expiry in lockstep with store touch; removing it silently reintroduces fixed-deadline logouts.

**Why:** active Okta users were 401'd purely because the short-lived access token expired without a refresh token, and refreshed tokens weren't saved to the session.

**How to apply:** any change to `isAuthenticated`, session options, or provider refreshToken must keep these paths; regression suite: tests/auth/session-lifecycle.test.ts.

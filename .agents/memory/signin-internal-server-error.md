---
name: White "Internal Server Error" at the sign-in screen (Clerk)
description: What causes the browser-specific 500 on the login page and how to resolve it (user-side + deploy-side).
---

# "Internal Server Error" on the sign-in / login screen

**Symptom:** a user gets a white "Internal Server Error" page on the sign-in
screen of the production app, but can log in fine on *other* browsers / incognito.

**Cause:** a stale/expired Clerk session cookie in that one browser. On load, the
server's Clerk middleware tries to clear the expired session (async `req.logout()`
→ Set-Cookie) and that races with the static `res.sendFile(index.html)`, throwing
`ERR_HTTP_HEADERS_SENT`, which Express renders as a plain "Internal Server Error".
Related crash paths: a dropped Neon idle connection emitting an unhandled pool
`error` event. Browser-specific because only the browser holding the stale cookie
hits the expiry/refresh path.

**Mitigations already in the code** (commit "Fix internal server errors on session
expiration" + "Add error handling ... database connection drops"):
- `server/auth/providers/clerk.ts`: awaits `req.logout()` before continuing so the
  Set-Cookie finishes before any response writer runs.
- `server/index.ts` error handler: if `res.headersSent`, `res.end()` cleanly
  instead of letting Express emit the plain-text 500 page.
- `server/storage/db.ts`: `pool.on("error", ...)` so a terminated idle Neon
  connection doesn't crash the process.

**Resolution:**
1. *Immediate, user-side:* have the affected user clear cookies/site data for the
   app domain (or use incognito / full sign-out) to drop the stale Clerk cookie.
2. *Durable, deploy-side:* these are code fixes — production only gets them after a
   **re-Publish**. If prod still shows the error, prod is likely running code from
   before these commits.

**Why this matters:** like DB constraint changes, server-side fixes do nothing for
production until re-published; "I applied the patch" usually means committed-but-not-deployed.

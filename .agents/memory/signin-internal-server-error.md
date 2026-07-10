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

**Root-cause fix (the REAL one — the earlier attempts did not work):** the crash
is uncatchable by design, so you must remove the async fs window, not contain the
throw. `res.sendFile(index.html)` streams via the `send` library, which sets the
response headers (Content-Type/ETag/...) from INSIDE its async `fs.stat`
completion callback. On an authenticated document request the session/auth layer
(`getSession()` + `passport.session()` run globally, even on `GET /login`) flushes
an async `Set-Cookie`; if that lands first, `send`'s later `res.setHeader` throws
`ERR_HTTP_HEADERS_SENT` *synchronously inside a native fs callback*
(`FSReqCallback.oncomplete`). That throw bypasses BOTH the Express error handler
AND `res.sendFile`'s own error callback — so guarding/containing it in
`serveStatic` cannot help, and Express renders a plain white "Internal Server
Error". **Fix:** preload `index.html` into a Buffer ONCE at boot and serve the SPA
catch-all with a synchronous `res.type("html").send(buffer)` (guarded by
`if (res.headersSent) return`). `res.send(buffer)` stages all headers
synchronously in one tick — no async fs window for the cookie to race into.
`express.static` (real assets) still uses `send`; left unchanged since the symptom
is the login document/shell, but if asset-URL races appear, exempt static paths
from the auth/session middleware.

**THE decisive trap — `express.static` default index:** `serveStatic` mounts
`express.static(distPath)` BEFORE the buffer catch-all, and serve-static defaults
to `index: ['index.html']`. So `GET /` (the login screen) is served by
`express.static` THROUGH `send`'s racy async fs path — the catch-all never runs
for `/`. This is why the crash persisted even after the catch-all stopped using
`send`. **Required:** `express.static(distPath, { index: false })` so every
HTML-shell request (incl. `/` and SPA deep links) falls through to the synchronous
buffer handler; express.static then only serves real named asset files. When
diagnosing a `send/index.js` throw, remember express.static uses `send` too — it
is not enough to fix only your own `res.sendFile`/catch-all.

**Failed attempts (don't repeat):** (1) scoping the custom Clerk resolution
middleware to `/api` only — harmless but not the fix (the racy writer is the
global clerk/session layer). (2) Guard + error callback around `res.sendFile` —
cannot catch a synchronous throw inside a native fs callback. (3) Buffer-serving
the catch-all alone — bypassed for `/` by express.static's default index.

**Resolution:**
1. *Immediate, user-side:* have the affected user clear cookies/site data for the
   app domain (or use incognito / full sign-out) to drop the stale Clerk cookie.
2. *Durable, deploy-side:* these are code fixes — production only gets them after a
   **re-Publish**. If prod still shows the error, prod is likely running code from
   before these commits.

**Log signatures to tell the two states apart:** the *unfixed* race is
`Error: Can't set headers after they are sent` with a stack purely in
`node_modules/send/index.js` (no app frames). The *contained-but-not-eliminated*
state logs `[static] index.html send failed: ... headersSent=... code=...` from
the serveStatic callback; `code=ECONNABORTED headersSent=false` there is a benign
client abort, not the header race.

**Why this matters:** like DB constraint changes, server-side fixes do nothing for
production until re-published; "I applied the patch" usually means committed-but-not-deployed.

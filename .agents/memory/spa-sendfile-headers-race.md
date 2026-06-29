---
name: SPA catch-all sendFile / Set-Cookie race
description: Why the production SPA index.html fallback must guard headersSent and pass a sendFile callback
---

# SPA catch-all `res.sendFile` must be defensive

The production static handler (`serveStatic` in `server/vite.ts`, used only in
deployed/production via `production-entry.ts -> app-init.ts`) serves the SPA with
a catch-all `app.use("*", ...)` that returns `index.html`.

**Rule:** that catch-all must (1) `return` early if `res.headersSent`, and (2)
call `res.sendFile(indexHtml, (err) => ...)` with an error callback that ends the
response cleanly. Never use a bare `res.sendFile(...)` with no callback here.

**Why:** on an authenticated request, the session layer's async `Set-Cookie`
can flush the response headers while `send` (the library behind `res.sendFile`)
is still doing its async `fs.stat`. When `send` then writes headers it throws
`ERR_HTTP_HEADERS_SENT` from *inside its own stream callback*, which bypasses the
global Express error handlers (they already guard `res.headersSent`, but they
never see this throw). The result the user reports is an intermittent **white
"Internal Server Error" page**, and the deploy logs show repeated
`Error: Can't set headers after they are sent` with a stack purely in
`node_modules/send/index.js` (no app frames).

**How to apply:** keep the guard + callback. The callback converts the race into
a clean `res.end()` (or an explicit 500 with empty body if headers weren't sent
yet) instead of an unhandled throw. It logs (source `"static"`) so residual race
frequency is observable post-deploy. This is a *containment* fix at the SPA
boundary, not elimination of the upstream auth/session timing race — only chase
the upstream race if the callback-error log stays non-trivial after deploy. This
is production-only behavior; the dev workflow uses the Vite dev server, so the
path cannot be exercised locally.

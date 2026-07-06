---
name: Neon pool error handler
description: Why server/storage/db.ts must keep a Pool 'error' listener
---

The main DB pool in `server/storage/db.ts` uses `@neondatabase/serverless`'s
`Pool`. Neon drops idle pooled connections when its compute autosuspends or
restarts ("terminating connection due to administrator command"). node-postgres
surfaces this as an `'error'` event on the Pool.

**Rule:** the Pool MUST have an `'error'` listener attached.

**Why:** in Node, an EventEmitter that emits `'error'` with no listener throws
an uncaught exception and crashes the process. In production this showed up as
intermittent "Internal Server Error" for whoever was active (notably admin
users on the app constantly). The crash signature in deployment logs was
`@neondatabase/serverless/index.mjs ... new Error("Unhandled error...")`.

**How to apply:** keep `pool.on("error", ...)` in db.ts. The dead client is
discarded; the next query transparently gets a fresh connection. Any other
long-lived pg Pool added later (e.g. a second pool) needs the same handler.
connect-pg-simple's session-store pool already attaches its own handler, so it
is safe.

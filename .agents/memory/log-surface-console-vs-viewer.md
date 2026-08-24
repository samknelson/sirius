---
name: Which logger reaches the admin log viewer
description: The app logger writes to the console only; only the storage logger's entries land in winston_logs and the admin log viewer.
---

# Which logger reaches the admin log viewer

`server/logger.ts` exports two loggers with different transports:

- the general app `logger` — **console transport only**. Its `error`/`warn`/
  `info` lines appear in the workflow log and nowhere else.
- the `storageLogger` — carries the DB transport that writes `winston_logs`,
  which is what the admin log viewer reads. Storage-middleware entries and API
  request logs go through it.

**Why it matters:** when a plan asks "where does this failure actually
surface", the answer for anything logged with the app logger is *the server
log*, not the log viewer. A framework catch-and-log (e.g. the event-notifier
dispatcher reporting a failed config) is console-only, so an admin cannot see
it from the UI — say the requirement in the plugin's own description instead of
promising a viewer entry.

**How to apply:** before asserting a failure is "visible in the log viewer",
check which logger writes it. Verifying such a failure in a script means
capturing the process's own stdout, not querying `winston_logs` — and a
`winston_logs` query right after an action can also miss rows the DB transport
has not flushed yet.

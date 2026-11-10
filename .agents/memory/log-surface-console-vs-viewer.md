---
name: Which logger reaches the admin log viewer
description: The app logger writes to the console only; only the storage logger's entries land in winston_logs and the admin log viewer.
---

# Which logger reaches the admin log viewer

The app logger is console-only; the storage logger is what reaches
`winston_logs` and the admin log viewer.

**Why:** a failure handled by application code can be visible in server logs
without creating an administrator-visible audit entry.

**How to apply:** choose the logger based on the required audience and do not
claim a console-only failure is available in the log viewer.

An audit-transport startup failure can be caught while the process continues
successfully with console logging only.

**Why:** A standalone financial inventory completed with exit code zero after
an import-cycle initialization error prevented the database audit transport
from attaching. A successful inventory exit therefore cannot prove an
audited write path is ready.

**How to apply:** For audited standalone repairs, require transport attachment
before mutation and verify persisted audit evidence afterward. Do not dismiss
a transport initialization warning because the command returned success.

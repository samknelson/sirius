---
name: ShellExec background process lifetime
description: Background/nohup processes die when the ShellExec call ends; use a temp console workflow for long one-shot jobs
---

Background processes (`nohup … &`, even `setsid … & disown`) launched from a
ShellExec call are killed when that call returns. `pgrep -f <pattern>` lies —
it matches the polling shell's own command line.

**Why:** long one-shot jobs launched this way die silently mid-run with no
error in their log.

**How to apply:** for any job longer than the 5-minute ShellExec budget, use a
temporary console workflow (`bash -c '<job> > /tmp/x.log 2>&1; echo EXIT_CODE=$? >> /tmp/x.log; sleep 7200'`),
poll the log file, remove the workflow when done. Verify progress by external
effect (log growth, DB row counts), never `pgrep -f`.

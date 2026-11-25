---
name: Incomplete dependency snapshots
description: Distinguishing incomplete task-workspace dependencies from application type errors.
---

Treat a populated dependency directory as potentially incomplete when executable links or a package's own declared type files are missing.

**Why:** A task workspace contained package directories but lacked executable links and several bundled declaration files. This produced both command-not-found failures and misleading missing-declaration/implicit-any errors in unchanged application code.

**How to apply:** Check the missing executable and the installed package's declared type entry before adding declarations or changing application types. Restore affected packages at their exact lockfile versions through the package-management flow; remove an incomplete generated package directory first if needed. Keep application dependency versions unchanged and discard incidental installer metadata changes.

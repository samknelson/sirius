---
name: Loop assertions hide later failures
description: A reported single failing item in a looped test (help browser hosts, route audits) is only the first one; how to scope the fix.
---

# Loop assertions hide later failures

Rule: when a test asserts inside a loop over a registry (help entry paths
against router routes, audit-doc routes against help), the reported failure
is only the FIRST offending item. Before fixing or scoping, run a throwaway
copy of the loop that collects every offender.

**Why:** a task named one dead help path (`/config/phone-numbers`); removing
it exposed four more dead paths in the same assertion, plus a second test
that reads the route list from the help coverage audit doc. Route removals
(pages moved into vendor connections, deleted admin pages) had left help
paths and audit route lists behind.

**How to apply:** for help, the three places must move together: the
entry's `paths`, the route list in `docs/in-app-help-coverage-audit.md`, and
the id list in `docs/in-app-help-backfill-coverage.md`. A path with no
router host can never display, so removing it is behavior-neutral; an entry
whose every path is dead is removed, not re-homed onto a screen it was not
written for. Re-check the remaining wording against the pages that are left.

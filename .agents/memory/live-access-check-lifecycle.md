---
name: Live access-check lifecycle
description: Avoid remount loops when a host hides children during fresh authorization checks.
---

When a host unmounts its children while an access check is fetching, its children must not independently mount an observer for that same always-stale access query. Pass the authorized audience into the read renderer instead; keep the standalone renderer's gate for ungated hosts.

**Why:** Mounting the child starts another access refetch, which makes the host hide and unmount it. Remounting can repeat that cycle indefinitely even though every access response grants permission.

**How to apply:** Inspect observer ownership whenever an access query uses zero stale time and a parent gates rendering on fetching. Keep server authorization in place independently of client rendering.

---
name: Boot-status HTTP surface
description: Why boot status answers on four addresses and why a not-ready response must name its phase; constraints imposed by the two-service-behind-one-ALB deployment.
---

# Boot status over HTTP

**Rule 1 — a not-ready answer must name its phase.** The states a booting
process can be in are not interchangeable: still initializing (will change on
its own), initialization permanently failed (never will), and stopped on
purpose for a report. One shared "starting, please wait" body for all three
tells an operator to wait for something that will never happen. Every
not-ready response carries phase + boot identity + blocker + drift result, so
two rolled tasks can also be told apart.

**Why:** a wedged deployment where the UI served fine and every API call said
"starting" left no way to tell a hung boot from a dead one.

**Rule 2 — a status address must exist under every prefix the load balancer
routes on.** One image runs as TWO services behind a single ALB: `/*` → UI
service, `/api/*` → API service. A status endpoint registered only at a root
path is unreachable for the API service, and an ALB fixed-response health rule
can shadow the root health path before it reaches the app at all. So the
status answers on both prefixes AND on a second spelling (`/boot-status`,
`/api/boot-status`) that no load-balancer health rule occupies.

**How to apply:** register the status routes and the not-ready gate FIRST in an
entry point, before any initialization — "before bootstrap finishes" is the
only moment they matter, and it also stops a later application route from
taking one of the paths. Both entry points (dev and production) must register
the same shared module, or they drift.

## Adjacent invariants worth not re-litigating

- Status addresses always answer HTTP 200, in every phase, and a failed init
  never exits the process. Deliberate: the task must stabilize so the failure
  stays observable instead of crash-looping.
- Detail exposure is one gate (`EXPOSE_BOOT_ERRORS=1`) covering error text,
  stack, and the bring-up report. Phase + blocker are always shown; they are
  safe anywhere.
- Only the still-initializing page auto-refreshes. Refreshing a terminal state
  forever just hides that it is terminal.
- The boot-status body is also the `/health` body; the admin Restart page polls
  it and watches `status === "ready"` plus a changed boot id, so those two keys
  cannot be renamed without changing that page.

## Proving it

The states only exist in a real boot, so verify against a BUILT bundle, not
source: bogus DB host = init-failed, a TCP listener that accepts and never
answers = a long-lived still-starting window, `BRINGUP_REPORT_ONLY=1` =
report-only, real DB = ready. Probe an API path and a UI path in each.

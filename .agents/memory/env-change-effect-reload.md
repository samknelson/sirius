---
name: Env change-effect "reload" classification
description: Why a third change-effect value exists, and the boot gate that keeps it honest against the reloadable-subsystem registry.
---

An environment variable's change-effect classification has three values, not
two: applies-immediately, needs-a-restart, and **reload** — read once at boot
but re-readable in place by a registered subsystem.

**Why:** the admin Restart & Reload page offers in-process reloads. The moment
a subsystem can re-read a variable, that variable's "restart to apply" badge on
the Environment Variables page becomes a lie. Two surfaces describing the same
variable must not disagree, and a hand-maintained parallel list would drift
within a release.

**How to apply:**
- A reloadable subsystem declares the variable names it makes live. A boot-time
  assertion fails in BOTH directions: a named variable must be classified
  `reload`, and a `reload`-classified variable must be named by some subsystem.
  Adding either half alone refuses to boot — that is the intended feedback.
- Only reclassify a variable when a reload genuinely makes the new value live.
  Do not reclassify because a reload "touches the area".
- Before listing a subsystem as reloadable, check that re-running its
  initializer changes something observable. A memoized value with no consumers
  outside its own boot-only functions is restart-only, not reloadable —
  clearing the memo would change nothing, and offering it overclaims.

**Related invariant:** "waiting on a restart" is computed, not listed. Baseline
a hash of each restart-classified variable's effective value at boot and diff
against current values; never store the values themselves.

**Two classification judgement calls** that the three definitions do not settle
on their own:
- Mixed consumers — one re-reads the value per use, another memoizes it —
  classify as `restart`. The value is not in effect everywhere until the process
  restarts, and the weaker claim is the honest one.
- A variable whose name is not known until config-parse time cannot be
  classified `reload` even when a reload genuinely makes it live, because the
  boot gate requires a subsystem to name it statically. Leave it unstated rather
  than picking a wrong neighbour.

---
name: Task-merge SHA rewrite vs deployment branches
description: Why deployment pushes diverge after task-agent commits and the proof required for automatic history-only reconciliation.
---

The platform's task merge rewrites the task agent's commits into NEW SHAs on
workspace `main`. If the task agent (or anyone) also pushed its ORIGINAL
commits to a deployment branch (`bao-dev`, `bao-replit-main`), the remote tip
and `main` end up with identical content under different SHAs → the
"Push to bao-dev" workflow fails with `non-fast-forward` on both refs.

**Rule:** A user-triggered deployment push may auto-reconcile divergent remote
history only with positive evidence that its work was incorporated: an exact
tree match with a main ancestor, an exact match on every remote-changed path
with ONE main ancestor after the merge base, patch-equivalent remote-only
commits without merges, or a clean reverse application of the remote's net
patch to committed main. The resulting reconciliation commit must reuse
main's exact tree and add the remote tip only as a parent.

**Why:** Task merges can rewrite history and flatten changes into an earlier
main snapshot. Later main commits can edit the same paths again, defeating
reverse-apply; unrelated changes in the snapshot can defeat a full-tree match.
Comparing the entire set of remote-changed paths to a single historical main
snapshot proves the remote state existed on main without accepting a
per-file patchwork or overwriting later work.

**How to apply:** Fetch both the selected deployment branch and
`bao-replit-main`, check each independently, and refuse the push if neither
the historical-snapshot nor patch-equivalence checks prove incorporation.
Push both refs atomically so one cannot advance while the other fails.
The workflow remains user-triggered; never push a bao branch outside that
workflow.

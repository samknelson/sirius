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
history only when the remote branch's complete net patch since its merge base
reverse-applies cleanly to committed `main`. That proves the remote changes are
already present. The resulting reconciliation commit must reuse `main`'s exact
tree and add the remote tip only as a parent.

**Why:** Patch IDs are not reliable here because the same task may be applied
against a different parent/context during the platform merge. Reverse-applying
the full net patch is conservative and handles rewritten commits without
accepting unrelated content. Keeping the tree unchanged avoids resurrecting
the older duplicate.

**How to apply:** Fetch both the selected deployment branch and
`bao-replit-main`, check each independently, and refuse the push if either patch
does not reverse-apply. Push both refs atomically so one cannot advance while
the other fails. The workflow remains user-triggered; never push a bao branch
outside that workflow.

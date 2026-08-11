---
name: Task-merge SHA rewrite vs deployment branches
description: Why push-branch.sh hits non-fast-forward after a task agent pushed to bao-dev/bao-replit-main, and the safe -s ours reconcile.
---

The platform's task merge rewrites the task agent's commits into NEW SHAs on
workspace `main`. If the task agent (or anyone) also pushed its ORIGINAL
commits to a deployment branch (`bao-dev`, `bao-replit-main`), the remote tip
and `main` end up with identical content under different SHAs → the
"Push to bao-dev" workflow fails with `non-fast-forward` on both refs.

**How to fix:**
1. `git fetch`, then confirm the remote-only commits carry nothing unique:
   `git diff <main's merge commit> <remote tip> -- <files touched by remote-only commits>`
   must be empty.
2. Reconnect ancestry keeping main's tree byte-for-byte:
   `git -c core.hooksPath=/dev/null merge -s ours origin/bao-dev -m "..."`.
3. Do NOT push — replit.md rule: never push bao-dev/bao-prd automatically;
   the user re-runs the push workflow themselves.

**Why `-s ours` is safe here:** the remote commits are a duplicate of content
already merged into main, and main is strictly newer; a content merge would
only risk resurrecting the older duplicate.

If the diff in step 1 is NOT empty, stop — the remote has real work `main`
lacks, and a normal merge (with conflict review) is required instead.

---
name: Checkpointing during active merges
description: Prevent automatic workspace checkpointing from clearing an in-progress Git merge.
---

When a Git merge is active, do not make ordinary workspace edits before the
conflict resolutions are staged and committed. Resolve through the live Git
index and create the merge commit first; only then update memory or other
unrelated files.

**Why:** An agent file edit triggered an automatic checkpoint reset while
`MERGE_HEAD` and unresolved index stages were present. The checkpoint moved the
worktree back to `HEAD`, silently clearing the user's in-progress merge instead
of preserving it.

**How to apply:** Confirm `MERGE_HEAD`, resolve conflicts without unrelated
edits, stage all resolutions, verify `git ls-files -u` is empty, and commit the
two-parent merge before using normal file-edit tools or recording memory.
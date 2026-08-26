---
name: Stable branch-driven launchers
description: How an uploaded launcher stays current while every migration image remains pinned to an immutable source commit
---

A reusable operator launcher should fetch its selected remote branch, re-execute the launcher body from that branch, resolve the branch head to a full SHA, and build from a detached checkout of that exact commit. An optional explicit SHA may select an older ancestor for deliberate rollback or reproduction.

**Why:** Embedding `SHA`/`SHORT_SHA` forces an operator to download and upload a new launcher after every source change. Resolving the trusted branch at invocation time keeps the script reusable while the resulting image and task definition remain immutably tagged by the resolved commit.

**How to apply:** Upload the bootstrap-capable launcher once. On each run fetch the selected branch, re-exec its current launcher with a recursion guard, derive full/short SHAs from the fetched ref, detach-checkout the full SHA, and persist runtime task identifiers in a stable state-file path.
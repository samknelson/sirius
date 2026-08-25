---
name: Tracked launcher source pins
description: How a launcher committed beside the source can pin an immutable build without requiring an impossible self-referential commit SHA
---

A launcher tracked in the same branch as its source should pin the last reviewed source commit before launcher-only changes, require that pin to be an ancestor of the branch tip, and build from a detached checkout of the pin.

**Why:** A commit hash includes the launcher's contents, so the launcher cannot embed its own final commit SHA. Requiring the branch tip to equal the embedded SHA also breaks as soon as a launcher-only commit advances the branch.

**How to apply:** Update `SHA`/`SHORT_SHA` to the reviewed source commit, verify it with `git merge-base --is-ancestor "$SHA" origin/<branch>`, then `git checkout --detach "$SHA"` and require a clean tree before building.
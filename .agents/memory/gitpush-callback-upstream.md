---
name: gitPush callback needs upstream tracking
description: How to push main's commits to bao-dev/bao-prd when the remote branch already exists.
---

Shell `git push` always fails auth here; use the `gitPush` CodeExecution callback. But when the remote branch already exists, calling it on a local branch WITHOUT an upstream fails with opaque `BRANCH_ALREADY_EXISTS`, and calling it from `main` fails with "current branch already tracks origin/main".

**Working recipe:**
1. `git branch -f <target> main && git checkout <target>`
2. `git branch -u origin/<target> <target>`  ← the step that fixes BRANCH_ALREADY_EXISTS
3. `gitPush({ branch: "<target>" })`
4. `git checkout main && git branch -D <target>`

**Why:** the callback publishes new branches or pushes the current branch to its tracked upstream; an untracked local branch shadowing an existing remote branch hits the "publish" path and collides.

**How to apply:** every push to bao-dev / bao-prd.

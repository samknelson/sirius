---
name: gitPush callback needs upstream tracking
description: Pushing to an existing remote branch (bao-dev/bao-prd) requires upstream tracking first.
---

Shell `git push` always fails auth here; use the `gitPush` CodeExecution callback. The durable constraint: an untracked local branch shadowing an existing remote branch hits the callback's "publish new branch" path and fails with opaque `BRANCH_ALREADY_EXISTS` — set upstream first (`git branch -u origin/<b> <b>`), then `gitPush({ branch: "<b>" })`.

---
name: gitPush callback needs upstream tracking
description: Pushing to an existing remote branch (bao-dev/bao-prd) requires upstream tracking first.
---

Shell `git push` always fails auth here; use the `gitPush` CodeExecution callback. The durable constraint: an untracked local branch shadowing an existing remote branch hits the callback's "publish new branch" path and fails with opaque `BRANCH_ALREADY_EXISTS` — set upstream first (`git branch -u origin/<b> <b>`), then `gitPush({ branch: "<b>" })`.

**Preferred path now:** the "Push to bao-dev" / "Push to bao-prd" workflows run
`scripts/dev/push-branch.sh <target>`, pushing workspace `main` to the target
branch AND `bao-replit-main` via the `GITHUB_TOKEN` secret (secrets reach managed
workflows, not plain Shell). The gitPush-callback recipe is the fallback.
`bao-replit-main` is a manual mirror — it only moves when one of these pushes runs.

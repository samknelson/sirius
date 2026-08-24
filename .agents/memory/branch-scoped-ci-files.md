---
name: Branch-scoped CI/deploy directories
description: .github and deploy are per-branch; why .gitignore doesn't keep them off main, and how to add/remove them correctly.
---

# Branch-scoped CI/deploy directories

`.github/` and `deploy/` are **branch-specific**: each deployment branch carries its own
copy, and they must never be tracked on `main`. `.gitignore` lists both directories.

**Why:** the owner keeps CI/deploy config per environment branch, not centrally. A copy on
`main` also means every `main` push needs the GitHub `workflow` OAuth scope, which the
OAuth App here does not have by default — pushes are rejected outright.

**How to apply:**

- **`.gitignore` does NOT keep them off a branch.** Ignore rules only apply to files git is
  not already tracking. Once any branch tracks them, a merge from that branch carries them
  in, and they stay tracked wherever they land. This is exactly how they reached `main`: a
  task agent branched from a branch that tracked them, and the task merge brought them along.
- **`git add .github deploy` silently does nothing** on a branch where they are ignored —
  no error, no staged files, and the follow-up commit quietly omits them. This has already
  cost one debugging session where the files looked "deleted" but were on disk all along.
- To **add** them to a branch, copy from a branch that has them:
  `git checkout <source-branch> -- .github deploy`. That bypasses ignore rules. `git add -f`
  also works when the files are only on disk.
- To **remove** them from a branch while keeping the working copies:
  `git rm -r --cached .github deploy` then commit. Index-only; disk copies survive and go
  back to being ignored.
- A **new** file under these directories is untracked, so it is ignored even on a branch that
  already tracks its siblings — `git add -f <path>` is mandatory, and staging must be
  confirmed (`git diff --cached --name-only`) before committing.
- To land the same file on a **second branch** without switching the working tree, use a
  throwaway worktree: `git worktree add /tmp/wt <branch>`, copy the file in, `git add -f`,
  commit there, `git worktree remove --force`. An in-place `git checkout <other-branch>`
  swaps the whole tree and churns the running dev server for no reason.
- Verify with `git ls-tree -r --name-only <branch> -- .github deploy` per branch rather than
  trusting `git status`, which shows nothing once the files are ignored-and-untracked.

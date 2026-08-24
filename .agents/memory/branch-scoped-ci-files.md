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
- An architecture-lint rule now enforces the `main` half of this automatically: it is
  branch-conditional (fails only on `main`, passes elsewhere so carrying branches keep their
  copies) and reads the commit with `git ls-tree`, not the working tree. It catches an
  incoming merge at task-completion time, not the pushes carrying branches make.

## Merge direction is load-bearing: only main → branch, never branch → main

Once more than one branch carries these directories, **merging any of them into `main` can
break all the others**, and stripping the directories inside the merge commit makes it worse
rather than better.

**Why:** each carrying branch has commits that add the files and commits that delete them.
Merging one into `main` pulls that history into `main`'s ancestry and can move the merge base
for another carrying branch onto a commit where the files exist. Its next `git merge main`
then sees "present in base, absent in theirs" and takes the deletion — silently for files it
never edited, as a modify/delete conflict for ones it did. This is graph-dependent, not
guaranteed: merge bases are derived from the commit graph, and with a criss-cross the ort
strategy synthesizes a virtual base from several. That uncertainty is the argument for
avoiding the direction entirely rather than reasoning case-by-case about whether it is safe
this time. Stripping the directories in the merge commit turns the deletion into a real
commit on `main` that propagates straight back on the next merge.

**How to apply:** when real code is stranded on a carrying branch, cherry-pick it onto
`main`; never merge the branch. After a carrying branch has merged `main` once, merges stay
clean for these paths as long as `main` never adds, deletes, or renames them — the base is a
main commit where they are simply absent, so "ours added, theirs never had it" resolves in
the branch's favour.

Check it cheaply, and know what the check covers: synthesize a same-tree future main commit
with `git commit-tree main^{tree} -p main -m x`, then
`git merge-tree --write-tree <branch> <that-commit>` and count the surviving files. That
verifies the current topology and the default merge driver preserve these paths. It does
**not** cover a future commit that actually touches them, a rename, or a different merge
strategy — re-check whenever `main` gains anything under these directories.

## Task agents delete these files just by running

An agent working in an isolated environment branches from a tree that does not have these
directories. The "commit prior to merge" snapshot it writes therefore records them as
deleted, and merging that work into a carrying branch wipes them. Nothing warns about it.

**Why:** the paths are gitignored, so they are invisible to `git status` and absent from any
environment that did not explicitly check them out.

**How to apply:** keep application work on `main` and treat carrying branches as
merge-target-only. After any agent work lands on one, re-check the file count before pushing.

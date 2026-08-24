---
name: Platform history re-parenting breaks long-lived branches
description: Why a long-lived side branch re-conflicts with main forever, and why rebuilding beats merging.
---

# Platform history re-parenting breaks long-lived branches

The platform periodically **rewrites main's history** (checkpoint rollback and task-merge
machinery). The rewrite produces commits that are content-identical to the originals —
same tree hash, same author *and* committer timestamps, same subject — but with different
parents. The originals become orphans.

**Why this matters:** a long-lived side branch that has already merged the original commits
now faces a fresh set of unrelated-looking commits carrying the same changes. Git has no way
to know they are the same work, so it re-litigates every one of them on the next merge. The
conflicts are not caused by anyone editing the branch; they regenerate on their own. In the
observed case, ~85% of the side branch's unique commits were such orphaned duplicates.

**How to apply:**

- Do not try to fix this with repeated merges, `rerere`, or conflict resolution — the same
  conflicts return after the next rewrite.
- For a branch that exists only to carry a small config delta, **rebuild it** rather than
  merge: branch fresh from `main`, re-apply the handful of real files, and discard the
  divergent history. Tag the old tip first so nothing is lost.
- Before discarding, confirm what is genuinely unique with
  `git log --oneline main..<branch>` and check each subject — duplicates of rewritten
  commits are safe to drop, and only the files the branch exists to carry actually matter.
- Diagnose by comparing tree hashes, not commit hashes: identical tree + identical author
  and committer dates + different parents is the signature of a re-parented duplicate.

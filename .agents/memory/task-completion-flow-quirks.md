---
name: Task completion flow quirks (stale review base, linearized reconcile merge)
description: Two ways markTaskComplete rejects or conflicts on work the task never touched, how to recognize each, and how to resolve without re-applying duplicate history.
---

## 1. The completion review can diff against a stale base

The review may compute the task's diff from the task environment's ORIGINAL
base commit, not from the rebased `main-repl/main` tip. If main advanced (another
task merged) between task start and completion, that other task's whole commit
shows up as "your" diff and the reviewer rejects you for its defects.

**Recognize:** the rejection names tables/files you never edited, and
`git diff --stat main-repl/main HEAD` shows only your files while
`git diff --stat <original base> HEAD` shows the extra commit.

**How to apply:** do NOT fix the other task's code inside yours (it collides
with whoever owns it). Verify the findings; if real, file them as follow-ups.
Resubmit with `request_fresh_code_review: true` and put the attribution
explanation in `drift_reason` (it is the only free-text channel the reviewer
sees besides the commit message).

## 2. A deploy "Reconcile" merge on the branch gets linearized into duplicate picks

If the "Push to bao-*" workflow ran while the task branch was open,
`push-branch.sh` leaves an `-s ours` commit "Reconcile origin/<branch> before
deployment push" (zero content change) whose second parent is the deploy
branch's rewritten-SHA history. The platform's task rebase does not preserve
merges: it turns that ancestry into picks of commits main already contains
under other SHAs (e.g. three successive amendments of one merged task).
Most of each pick auto-merges with zero change; the rest conflicts against
main's FINAL versions of the same files.

**Recognize:** conflicts in files the task never touched; `git diff <your
commit> <orig-head>` is empty; the todo lists picks whose subjects are already
merged work; `git diff --stat main-repl/main <final duplicate pick>` on the
touched paths shows only lines main added later.

**How to apply:** never resolve by merging — the intended end tree is
`main-repl/main` + the task's own commit. Convert the remaining picks to drops
(`GIT_SEQUENCE_EDITOR="sed -i 's/^pick /drop /'" git rebase --edit-todo`),
then `git rebase --skip` the conflicting pick (the allowed escape hatch), then
call `continueMergeResolution` (it reports `rebase_complete`) and
`markTaskComplete` again. Prove the result with an empty
`git diff <your commit> HEAD` and a one-file `git diff --stat main-repl/main HEAD`.
The deploy branch simply gets reconciled again by the next push workflow run.

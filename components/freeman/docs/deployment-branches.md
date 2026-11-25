# Deployment branch ownership

## Git remotes & branch policy

-   **`main` → `origin` (github.com/samknelson/sirius) only.** `main` must
    never contain `.github/` or `deploy/` — both are gitignored on main and
    were stripped from its history (the Replit Git token lacks the
    `workflow` scope, and the deploy env files must not reach origin).
-   **`freeman-dev` and `freeman-uat` → `freeman` remote only, never
    origin.** Each carries `.github/` (CI workflows) and `deploy/` on top of
    main, and nothing else of its own. To update either: merge `main` into
    it, then push it to the `freeman` remote.
-   **Merges only ever run `main` → `freeman-*`, never the reverse.** Both
    Freeman branches carry commits that add the CI files and commits that
    delete them. Merging either branch into `main` pulls that add/delete
    history into `main`'s ancestry, which can move the merge base for the
    *other* branch onto a commit where the CI files exist. When it does,
    that branch's next `git merge main` sees "present in base, absent in
    main" and takes the deletion — silently for untouched files, as a
    modify/delete conflict for edited ones. Whether it bites in any given
    case depends on the resulting graph, so treat it as a hazard to stay
    away from rather than a rule to reason around: the CI files have
    already been destroyed on `freeman-uat` twice. If real code is
    stranded on a Freeman branch, cherry-pick it onto `main` instead of
    merging the branch.
-   **Never point a task agent at a Freeman branch.** Application work is
    done on `main` only. A task agent branches from a tree that has no CI
    files, and the "commit prior to merge" snapshot it writes records them
    as deleted — which is exactly how `freeman-uat` lost them.
-   Edits to `.github/` or `deploy/` are committed on a Freeman branch only,
    using `git add -f` (the paths are gitignored). The on-disk copies in the
    main working tree are untracked-and-ignored — do not `git add` them.
-   **If the CI files vanish from a Freeman branch again**, restore them
    from a known-good source *for that environment* — the branch's own last
    good commit or a backup ref, and the other Freeman branch only while the
    two are known to be identical:

        git checkout <known-good-ref> -- .github deploy && git commit

    Then verify both the count and the contents. Count with
    `git ls-tree -r --name-only <branch> -- .github deploy` (8 files today);
    contents matter because once the branches carry environment-specific
    config, restoring from the wrong one silently overwrites it. `git status`
    shows nothing here once the files are ignored-and-untracked.
-   The `main-branch-files` architecture-lint rule enforces the first bullet:
    on `main` it fails when any `.github/` or `deploy/` file is tracked
    (`git ls-tree`, not `git status`) and tells you to run
    `git rm -r --cached .github deploy`. On a Freeman branch it fails when
    those directories have gone missing instead.
-   The `carrying-branch-drift` architecture-lint rule catches the opposite
    accident: a finished feature merged onto a Freeman branch because that
    was the branch checked out when the work completed, leaving it
    unreachable from `main`. It runs only on a Freeman branch and fails when
    that branch changed anything outside `.github/` and `deploy/` that still
    differs from `main`, naming the paths and the `git checkout <branch> --
    <paths>` repair. A branch merely *behind* `main` passes.
-   Helper script for the one-time history split: `.local/split-branches.sh`.


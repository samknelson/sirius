---
name: merge-resolver
description: Pull from origin/main and resolve merge conflicts with a triage-first approach, then verify, restart the app and commit the merge. Use when the user asks to pull, merge, sync with main, rebase, or resolve conflicts. Classifies conflicts by type and only auto-resolves the safe ones, surfacing risky conflicts for manual review instead of guessing.
---

# Merge Conflict Resolver

Merge the latest `origin/main` into the current branch, resolve conflicts with a triage-first approach, verify, and commit the merge. Do not auto-resolve everything — surface what's risky.

## Ground rules for this project

- **Git works from the agent shell.** `git fetch`, `git merge`, `git add`, `git rm`, `git mv`, `git commit` all run fine. (An older version of this skill claimed "Destructive git operations are not allowed" — that restriction no longer exists. If a git command is rejected, report the exact error instead of handing the whole merge to the user.)
- **Never `git stash` during a merge** — not even in a throwaway diagnostic command. Once every conflict is staged, `stash` succeeds, swallows the resolved tree AND drops `MERGE_HEAD`. (Recovery: `git merge --no-commit --no-ff origin/main`, then `git read-tree -u --reset stash@{0}`, re-verify, commit.)
- **Commit the merge as soon as it is resolved and verified.** Platform checkpoints can reset an uncommitted merge. Do not push — the user pushes after review (the `Push to bao-*` workflows exist for that).
- **Schema changes come from versioned migrations, not `db:push`.** Migrations run at app boot; the drift gate in `/health` confirms the schema matches. Never run `npm run db:push` for a merge (it is interactive and can destroy constraints — see `.agents/memory/drizzle-kit-push-hazards.md`).
- Read `.agents/memory/upstream-merge-playbook.md` first — it holds the fork-specific rules below and the known env-noise test failures.

## Step 1: Fetch, inventory, merge

1. `git fetch origin main` and report divergence: `git rev-list --left-right --count HEAD...origin/main`, `git log --oneline HEAD..origin/main`, working-tree cleanliness. If the tree is dirty or mid-merge/rebase, STOP and tell the user.
2. `git merge --no-commit --no-ff origin/main`.
3. If it applies cleanly, go to Step 3. Otherwise list conflicts (`git diff --name-only --diff-filter=U`) and classify each before editing anything:
   - **additive** — both sides added independent code (imports, functions, routes, test cases, registry entries). Auto-resolve keep-both.
   - **modification** — both sides changed the same logical thing. Requires judgment.
   - **structural** — renames, moves, signature changes (e.g. a table/module rename upstream that our fork code references). Requires judgment; usually resolved by taking upstream's structure and porting our additions onto it.
   - **generated/lockfile** — `package-lock.json` etc. Never hand-merge; regenerate.
   - **sensitive** — migrations, schema, auth/security, CI/infrastructure. Resolve only with the rules below; otherwise flag.

## Step 2: Resolve

- **Core migrations from upstream** collide with our version counter. `git mv` each incoming `scripts/migrate/core/NNNN_*.ts` to the next numbers above our max, update the version label inside, append to `scripts/migrate/index.ts`. A merged low-version migration is silently skipped.
- **Component migrations we own** that reference a core table upstream renamed must resolve the table name at run time (fresh install: core rename already ran; existing DB: our migration already ran before the rename).
- **Fork extensions removed upstream** (e.g. adapters, hooks our sitespecific code needs): re-add them as a clearly commented fork extension rather than rewriting the fork feature — and flag that judgment call to the user.
- **Registries/nav/tab lists:** take upstream's structure, re-insert only fork items upstream does not now serve (check whether upstream's registry-driven lists already cover them).
- After editing, `rg` for stale identifiers from any upstream rename (old table symbols, old API paths, old jsonb keys) across `server/ client/ shared/ scripts/ tests/`.
- Never silently delete code: if fork code must go, leave a comment saying what and why.
- When a conflict genuinely needs the user, show both versions (`// OURS` / `// THEIRS`), what each does, and a recommendation.

## Step 3: Verify

1. `npm run check`, `npm run lint`, `bash scripts/dev/check-migrations-merge.sh`.
2. Restart the `Start application` workflow; confirm `/health` reports `driftCheck: "passed"` and the renumbered migrations appear in the boot log.
3. Targeted vitest for the touched areas (full suite is long; known env-noise failures are listed in the playbook). Pre-existing dev-DB data can trip uniqueness rules — check `created_at` before blaming the merge.

If verification fails, fix the merge resolution (that is in scope) — but do not "fix" unrelated pre-existing failures as part of the merge; report them.

## Step 4: Commit and report

`git commit` the merge on the current branch with a message that lists the fork-port decisions. Report: incoming commit count, conflict classification, every judgment call, verification results, and that nothing was pushed. Then run the code-review round on the merge commit.

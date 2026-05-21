---
name: merge-resolver
description: Pull from origin/main and resolve merge conflicts with a triage-first approach, then sync the database schema and restart the app. Use when the user asks to pull, merge, sync with main, rebase, or resolve conflicts. Classifies conflicts by type and only auto-resolves the safe ones, surfacing risky conflicts for manual review instead of guessing.
---

# Merge Conflict Resolver

Pull the latest changes from `origin/main` into the current branch and resolve merge conflicts with a triage-first approach. Do not auto-resolve everything — surface what's risky. After the merge succeeds and verification passes, push any incoming database schema changes and restart the app so the running environment matches the merged code.

## IMPORTANT: Run this work in a project task

`git pull`, `git checkout --theirs`, `git add`, and other write-side git operations are blocked in the main agent environment on Replit. Do not try to run them directly from the main agent — the system will reject them with "Destructive git operations are not allowed in the main agent."

Workflow:

1. From the main agent in Build mode, do a quick read-only check (`git status`, `git log --oneline -5`) so you can describe the divergence to the user.
2. Write a plan file at `.local/tasks/pull-and-triage-merge.md` that contains the steps below.
3. Create and propose a single project task using `bulkCreateProjectTasks` + `proposeProjectTasks` (see `.local/skills/project_tasks/SKILL.md`). Title it something like "Pull origin/main and triage conflicts".
4. The user approves it; the task agent runs in an isolated environment that IS allowed to perform git writes. The task agent's branch is auto-merged back to main when it finishes.

When you (the task agent) start executing the task, you may also need to:
- Clear a stale `.git/index.lock` if one exists from a prior aborted operation: `rm -f .git/index.lock`.
- Set a repo-local committer identity if none is configured: `git config user.email "agent@replit.local" && git config user.name "Replit Agent"`. Repo-local only — never `--global`.
- Pass an explicit reconciliation flag: `git pull --no-rebase origin main`. Replit runners typically have no `pull.rebase` default, so a bare `git pull` will fail with "Need to specify how to reconcile divergent branches."

## Step 1: Pull and inventory

Run `git pull --no-rebase origin main`.

If the merge is fast-forward or applies cleanly with **no conflicts**, git will create the merge commit automatically. Report success and tell the user:
- The number of incoming commits and files changed.
- That git auto-created the merge commit (this is unavoidable on a clean merge — `--no-commit` would have to be passed beforehand). If they'd prefer no merge commit, offer to `git reset --merge` and redo with `--no-commit` or `--rebase`.

Then skip ahead to **Step 5: Post-merge sync** to push any DB schema changes and restart the app. Do not stop before that step.

If there are conflicts, **DO NOT start editing files yet.** First, list every conflicted file (`git diff --name-only --diff-filter=U`) and classify each one:

- **additive** — both sides added new, independent code (new imports, new functions, new test cases, new routes). Safe to auto-resolve.
- **modification** — both sides changed the same logical thing (config values, function bodies, constants, altered control flow). Requires judgment.
- **structural** — refactors, renames, moves, signature changes. Requires judgment.
- **generated/lockfile** — `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `Pipfile.lock`, `poetry.lock`, `go.sum`, build artifacts, minified bundles. Never hand-merge.
- **sensitive** — migrations, schema files, auth/security code, CI config, infrastructure files. Never auto-resolve.

Report this classification table to the user before proceeding.

## Step 2: Auto-resolve only the safe category

For **additive** conflicts only: remove the markers, keep both sides, ensure the result is syntactically valid (no duplicate imports, signatures, or closing braces).

For **modification** and **structural** conflicts: stop and ask the user. Show both sides and a recommendation. Do not guess.

For **generated/lockfile** conflicts: do not edit the file. Take the incoming version (`git checkout --theirs <file>`) and regenerate it with the appropriate command:
- npm: `npm install`
- pnpm: `pnpm install`
- yarn: `yarn install`
- cargo: `cargo update`
- poetry: `poetry lock --no-update`
- pipenv: `pipenv lock`
- go modules: `go mod tidy`

Tell the user which command was run.

For **sensitive** conflicts: stop and ask the user, always. No exceptions.

## Step 3: Verify

After resolving the safe set, run in order:

1. **Syntax/type check** appropriate to the language and project:
   - TypeScript: `npx tsc --noEmit` (or whatever script `package.json` exposes, e.g. `npm run check`)
   - Python: `python -m py_compile <files>` or `mypy` if configured
   - Node: `node --check <file>`
   - Rust: `cargo check`
   - Go: `go build ./...`
2. **Test suite** if one exists. Detect by checking, in order: `package.json` scripts (`npm test`), `pytest` config, `cargo test`, a `Makefile` target. Use what the project actually uses — don't invent a command.

If either fails, stop and report the failure verbatim. Do not try to fix test failures by further editing the merge — that's the user's call.

## Step 4: Stage but do not commit

Stage the resolved files with `git add <file>`, but **leave the merge commit for the user to create after they review the diff. Do not run `git commit`.**

This step only applies when there were actual conflicts to resolve. On a clean fast-forward or auto-merge, git already created the commit in Step 1; flag this clearly to the user.

## Step 5: Post-merge sync (DB push + app restart)

Run this step on **both** clean auto-merges (after Step 1) and conflict resolutions (after staging in Step 4 and verification in Step 3 has passed). Do not run it if verification failed or if there are still unresolved conflicts.

1. **Push DB schema changes.** Use the project's existing Drizzle push script — do not invent a command. In this repo that is `npm run db:push` (check `package.json` scripts to confirm; if the project uses a different script name like `pnpm db:push` or `yarn db:push`, use that instead).
   - Run `npm run db:push` first, without `--force`.
   - If Drizzle prints a data-loss warning (e.g. "you're about to delete/truncate", column drops, table renames it can't reconcile), **stop and ask the user** before re-running. Show them the exact warning. Only run `npm run db:push -- --force` (or the package manager's equivalent passthrough) after the user explicitly confirms they accept the data loss.
   - Never pass `--force` preemptively, and never run destructive SQL by hand to "help" the push along.
   - If the script exits cleanly with no warnings, report what changed (or that nothing changed) and continue.

2. **Restart the app.** Use the workflow tooling to restart the `Start application` workflow rather than running ad-hoc shell commands like `npm run dev` or killing processes. See `.local/skills/workflows/SKILL.md` for the exact tool. This ensures the running environment picks up the merged code and the new schema.

3. **Report** to the user: which DB push command was run, whether it warned about data loss, and that the workflow was restarted.

## Rules that always apply

- Never silently delete code. If local code has to be dropped or restructured to accommodate incoming changes, add an inline comment explaining what was removed and why.
- Never guess on intent. "Flag for review" is always a valid outcome and is preferred over a confident wrong answer.
- When asking the user about a conflict, show:
  - The file path
  - Both versions side by side (use fenced code blocks labeled `// OURS` and `// THEIRS`)
  - A one-sentence description of what each side seems to be doing
  - A recommendation
- Never push to remote. The user pushes themselves after reviewing.
- Never run `git reset --hard`, `git clean -fd`, or any history-rewriting command without explicit user confirmation.
- Never run a destructive DB push (e.g. `db:push --force` or any command that drops/truncates data) without explicit user confirmation. Surface the Drizzle warning and wait for an answer.

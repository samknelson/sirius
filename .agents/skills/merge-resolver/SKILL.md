---
name: merge-resolver
description: Pull from origin/main and resolve merge conflicts with a triage-first approach, then sync the database schema and restart the app. Use when the user asks to pull, merge, sync with main, rebase, or resolve conflicts. Classifies conflicts by type and only auto-resolves the safe ones, surfacing risky conflicts for manual review instead of guessing.
---

# Merge Conflict Resolver

Pull the latest changes from `origin/main` into the current branch and resolve merge conflicts with a triage-first approach. Do not auto-resolve everything — surface what's risky. After the merge succeeds and verification passes, push any incoming database schema changes and restart the app so the running environment matches the merged code.

## IMPORTANT: Platform git restrictions on this project

On this Replit, the platform allows `git pull` and `git fetch` from the main agent, but blocks almost every other git write — `git config`, `git add`, `git checkout --theirs`, `git commit`, `git rebase --continue|--abort`, `rm` on `.git/*.lock`, etc. — with the message: **"Destructive git operations are not allowed in the main agent."**

Routing through a project task does NOT help: the task-agent environment has the same restrictions on this project, and a failed attempt there leaves behind stale `.git/*.lock` files that the user has to clean up manually. **Do not propose a project task for the pull.** Run it directly from the main agent.

What this means in practice:

- **You CAN** run `git pull --no-rebase origin main` directly from the main agent. Read-only checks (`git status`, `git log`, `git diff`) also work. If the pull is a clean fast-forward / auto-merge, git creates the merge commit itself and there is nothing further to stage.
- **You CANNOT** auto-resolve conflicts in this skill. The moment `git pull` reports conflicts, stop. You cannot `git add` resolved files, you cannot `git checkout --theirs <lockfile>`, you cannot `git rebase --abort`, you cannot `git config`, and you cannot remove a stale `.git/*.lock`. List the conflicted files to the user and hand off — they resolve via Replit's git pane or their own shell.

Pre-flight (read-only, from the main agent):
- `git --no-optional-locks status` — confirm working tree is clean and see divergence.
- `git --no-optional-locks fetch origin main` — refresh the remote tracking ref.
- `git --no-optional-locks rev-list --count HEAD..origin/main` — count incoming commits.
- `git --no-optional-locks rev-list --count origin/main..HEAD` — count local-ahead commits.

Then describe the divergence to the user before pulling. Pass an explicit reconciliation flag: `git pull --no-rebase origin main`. Replit runners typically have no `pull.rebase` default, so a bare `git pull` will fail with "Need to specify how to reconcile divergent branches."

If the working tree is **not** clean (mid-rebase, mid-merge, staged changes, unmerged paths), STOP before touching anything. Report the state to the user and ask them to resolve it in Replit's git pane / shell — you cannot abort a rebase, stage files, or commit from here.

**Check for stale `.git/*.lock` files BEFORE attempting the pull.** Even from prior aborted attempts, files like `.git/ORIG_HEAD.lock`, `.git/index.lock`, `.git/config.lock`, or `.git/objects/maintenance.lock` will cause `git pull` to fail with "Another git process seems to be running in this repository." You cannot remove these files yourself — any `rm` under `.git/` is blocked. If `ls .git/*.lock` shows anything, ask the user to run `rm .git/*.lock` in their shell before you proceed.

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

## Step 2: Hand conflicts back to the user

On this project you cannot resolve conflicts yourself — `git add`, `git checkout --theirs`, and `git commit` are all blocked. If `git pull` reports any conflicts, do this and stop:

1. List conflicted files: `git --no-optional-locks diff --name-only --diff-filter=U`.
2. Classify each one for the user's benefit (additive / modification / structural / generated-lockfile / sensitive) and include a short recommendation per file.
3. Tell the user the merge is paused in their working tree and they need to resolve it in Replit's git pane or their own shell, then complete the merge commit themselves.
4. Do NOT continue to Step 3, 4, or 5. Do not run db:push or restart the workflow until the user confirms the merge commit is in.

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

## Step 4: Skipped on this project

Staging and committing are blocked here. On a clean fast-forward / auto-merge, git already created the commit in Step 1 — flag this clearly to the user. On a conflicted merge, you already stopped in Step 2 and handed off; the user creates the merge commit themselves.

## Step 5: Post-merge sync (DB push + app restart)

Run this step ONLY after a clean auto-merge (Step 1) AND Step 3 verification passed. Do not run it if there were conflicts — wait for the user to confirm they've completed the merge commit.

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

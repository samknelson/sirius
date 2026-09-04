---
name: Upstream (origin/main) merge playbook for the BAO fork
description: Non-obvious hazards when merging origin/main into this fork — migration counter renumbering, keep-both hunks splitting JSDoc, new architecture lint rules, and which test failures are environment noise.
---

# Merging origin/main into the BAO fork

**Rule 1 — renumber, never keep, upstream core migrations below our counter.**
Upstream numbers core migrations from a lower counter than this fork. Any
upstream `scripts/migrate/core/NNNN_*.ts` with NNNN below our max version
would be *silently skipped* by the runner. Rename them to fresh numbers above
our max (bodies unchanged, update the `version:` label), append them to
`scripts/migrate/index.ts` with a comment naming the original numbers, and
prove it with `bash scripts/dev/check-migrations-merge.sh` (it checks against
origin/bao-dev and origin/bao-prd) plus a boot that logs `Running migration`.
**Why:** a skipped migration passes typecheck and boots clean; the miss only
shows up as a 42P01/42703 at request time.

**Rule 2 — "keep both" can split a JSDoc / JSX block.** A keep-both resolution
on a hunk whose boundary falls inside a `/** … */` comment or an open `<Route>`
leaves a dangling opener with no closer. `npm run check` catches it; look at
the hunk edges, not the hunk middles.

**Rule 3 — run `npm run lint` (architecture rules), not just tsc.** Upstream
adds rules (maintenance-guards, date-formatting, browser-timezone, …) that our
fork-only files may violate. For maintenance-guards: an outbound vendor call
in a fork module must be registered on the web client framework
(`registerUncachedWcRequest` when the caller owns its own durable cache) and
listed in `OUTBOUND_MODULES`. Anything that swallows errors on that path must
rethrow `MaintenanceModeError` (the eligibility executor's catch-all did not).

**Rule 4 — known environment-dependent test failures (not merge defects):**
- `tests/maintenance/external-services.test.ts` Google.validateAddress /
  parseAndValidate / "does not fall back" fail when the dev DB's
  `address_validation_config` variable is `mode: local` (it is here).
- `tests/edi/provider-edi-conformance.test.ts` fails for the seven
  `sitespecific-smf-*` providers on our main regardless of the merge (no
  layout fixtures yet).
- DB-backed `tests/sitespecific/bao-dc-*` deadlock (40P01 / 23505) when run in
  the same vitest invocation as other suites; alone they pass.
- Anything 42P01/42703 before the app has been booted once = migrations not
  yet applied to the dev DB (Rule 1), not a code error.

**How to apply:** after `git merge --no-commit origin/main`, resolve, then in
order: `npm run check` → `npm run lint` → migrations-merge check → restart app
and confirm `/health` `driftCheck: passed` + migration log → targeted vitest →
commit on `main` only. Never push `bao-*` from this step.

## Never `git stash` during a merge
Once every conflict is staged, `git stash` succeeds (before that it refuses
with "needs merge"), swallowing the resolved tree and deleting `MERGE_HEAD`.
Recovery: `git merge --no-commit --no-ff origin/main`, then
`git read-tree -u --reset stash@{0}` (worktree+index == stash tree), re-run
check/lint, commit, `git stash drop`. Keep diagnostic commands stash-free.

## Notes → entity-notes rename (Sept 2026)
Upstream renamed `notes`→`entity_notes`, `entity_type`→`context_id`,
note-type `data.entityTypes`→`data.contextIds`, `/api/notes`→`/api/entity-notes`.
BAO component migrations 009/010/014 resolve the table name at run time
(`coreNotesTable()`), because fresh installs run the core rename first while
existing DBs ran the component migrations before it.

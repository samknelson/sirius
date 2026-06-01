---
name: Author-time migration check vs untracked files
description: Why scripts/check-migrations.ts can false-fail in the main agent, and what the real enforcement is
---

# Author-time migration check and untracked migration files

`scripts/check-migrations.ts` detects added migration files via
`git diff --name-only HEAD` (and the base range). That only sees
**tracked** changes. A newly written migration file is untracked
(`git status` shows `??`) until it is committed, so the check reports
"schema change without migration" even though the file exists and is
correctly registered in `scripts/migrate/index.ts`.

**Why:** the main agent is blocked from running `git add` / `git commit`
(destructive git ops are disallowed). The automatic end-of-task commit
is what finally tracks the new migration, after which the check passes.

**How to apply:** when editing `shared/schema*` and adding a matching
migration under `scripts/migrate/...`, do not treat a check-migrations
failure that says "no new file added" as a real problem if you *did*
add and register the migration. The authoritative verification is the
startup **schema drift gate** (`server/services/schema-drift-check.ts`):
restart the `Start application` workflow and confirm
"Schema drift check passed" in the logs (it reflects the live DB and
runs pending component migrations for enabled components first). Also
confirm the live column shape directly via SQL when in doubt.

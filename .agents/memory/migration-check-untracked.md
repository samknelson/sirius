---
name: Author-time migration check vs untracked files
description: check-migrations now sees untracked files; the startup drift gate remains the runtime enforcement
---

# Author-time migration check and untracked files

`scripts/check-migrations.ts` historically detected changes only via
`git diff` (tracked changes), so a newly written, still-untracked
migration file caused a false "schema change without migration"
failure — and an untracked new schema file was invisible entirely.

**Fixed (July 2026):** `changedFiles()` now also includes
`git ls-files --others --exclude-standard`, so untracked migration
files count as accompanying migrations and untracked `shared/schema*`
files trigger the check.

**How to apply:** a check-migrations failure is now a real signal even
mid-task before any commit. The check (plus `check-constraint-names`
and `check-storage-encapsulation`) is registered as an automated
validation that runs on task completion — see replit.md Run & Operate.
The authoritative runtime verification remains the startup schema
drift gate (`server/services/schema-drift-check.ts`): restart the
`Start application` workflow and confirm "Schema drift check passed".

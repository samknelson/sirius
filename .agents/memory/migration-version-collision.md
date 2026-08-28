---
name: Migration version-counter collision on merge
description: Why a low-version incoming migration silently does nothing after merging diverged branches, and how to fix residual drift with a high-version baseline.
---

# Migration version-counter collision (Sirius migration framework)

**Author-time guard exists:** the migration check now rejects newly added core
migrations numbered at or below the version floor of both the current and base
branches — run it with `--base=<target>` when merging so target-only versions
count.

The core migration runner applies migrations in version order and only runs
those with `version > migrations_version`, bumping the counter on each success.
The same counter is shared by ALL core migration files.

**The trap:** when two branches diverge and each adds its own core migrations
using overlapping low version numbers, the local `migrations_version` can already
be *past* a version number that an incoming (merged) migration uses. That
incoming migration is then treated as already-applied and **silently skipped** —
even though its effect (e.g. a CREATE TABLE) never ran on this database. Result:
the startup drift gate (`server/services/schema-drift-check.ts`, fatal on any
drift) refuses to boot because the expected table/column is missing.

**Why baselines fix it:** baselines are registered as core migrations in the
reserved version range `>= 1000`. Because they sit above any normal counter
value, they always run. Use them to re-apply the skipped effect.

**How to apply (ordering matters):**
- Put preconditions that the *forward* migrations depend on in a baseline with a
  version BELOW the forward migrations (e.g. enum-type creation + text→enum
  column conversion before migrations that assume the enum exists).
- Put residual/post-cascade fixes in a baseline with a version ABOVE all forward
  migrations (e.g. a FK whose target table is only created mid-cascade). The
  dated drift-fix baseline pattern (`generateDriftFixStatements` over all core +
  enabled-component tables) safely SKIPS only `relation ... does not exist`
  errors, so an FK to a not-yet-created table is skipped on the early pass and
  must be re-applied by a late baseline once the target table exists.

**text→enum conversion gotcha:** a text column with a DEFAULT cannot be
`ALTER TYPE`'d directly. Sequence is `ALTER COLUMN ... DROP DEFAULT`, then
`ALTER COLUMN ... TYPE <enum> USING <col>::<enum>`, then re-`SET DEFAULT`.
Guard the whole block to run only while the column is still `text` so re-runs
are no-ops. Conversion assumes every existing value is a valid enum label.

**Re-running an edited baseline in dev:** to force an idempotent baseline to
re-run after you edit it, lower `migrations_version` back below its version
(via a storage/SQL update) — there is no per-migration "applied" ledger for core
migrations, only the single counter.

**Renumbering existing migrations:** renumbered idempotent migrations simply
re-run on databases whose counter already passed the old numbers — that's the
point. The check compares against the base ref's committed tree, so renames
must be committed before the check reports clean.

**Hard rule reminder:** this project REFUSES `drizzle-kit push` / `npm run
db:push` (gated behind `ALLOW_DB_PUSH=1`). Schema sync happens ONLY through the
startup migration framework. Never reach for db:push to resolve drift.

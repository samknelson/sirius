# Baselining a deployment

When a new deployment (a fresh Repl, a clone, a production cutover) has
a database whose shape predates the per-component migration framework,
its tables almost certainly do not exactly match `shared/schema*` and
the startup drift gate will refuse to boot. The fix is to write a
one-off baseline script that brings that specific database into sync.

**No shell on the target?** The procedure below assumes you can run the
server on the affected deployment. If you cannot (a deployed image where
your only levers are environment variables and a redeploy), read
[docs/aurora.md → Diagnosing a deployment with no shell](./aurora.md#diagnosing-a-deployment-with-no-shell)
first: deploy once with `BRINGUP_REPORT_ONLY=1`, read the bring-up
report and the drift correlation it prints, and only write a baseline if
that correlation reports **case C** (drift items no registered migration
covers). Cases A and B are repaired by a redeploy or by
`MIGRATIONS_RESUME_FROM_VERSION`, with no baseline at all. Use the drift
items from that report as the input to step 3 below, and author the
baseline on a machine you do have a shell on.

**Procedure** (give the prompt below to an agent on the affected Repl):

> Build mode. Baseline this Repl's database for the per-component
> migration framework.
>
> 1. Read `docs/baselining.md`.
> 2. Start the server once with `SKIP_SCHEMA_DRIFT_CHECK=1` set so it
>    boots. Then unset it and start again; copy the full drift report
>    that `StartupSchemaDriftError` prints to the workflow logs.
> 3. For every item in the report:
>    - Missing column → ALTER TABLE ADD COLUMN with the right type and
>      a safe default for any non-empty table.
>    - Type mismatch → ALTER TABLE ALTER COLUMN ... TYPE ... with an
>      explicit USING clause if a cast is needed.
>    - Missing index → CREATE INDEX IF NOT EXISTS.
>    - Missing constraint → ALTER TABLE ADD CONSTRAINT IF NOT EXISTS.
>    - Missing table → CREATE TABLE — but check first whether the
>      component should actually be enabled; an unexpected missing
>      table usually means a component was enabled by default but
>      never went through the enable flow.
> 4. Create `scripts/migrate/baseline/<this-replit-name>-<YYYYMMDD>.ts`
>    that performs every fix-up above using guards
>    (`IF NOT EXISTS` / column existence checks) so re-running is a
>    no-op. Register it via `registerMigration` with `baseline: true`, a
>    version `>= 1000` that is **below the highest ordinary core
>    migration version** and not already taken, and import it from
>    `scripts/migrate/index.ts`. (Startup refuses to boot if a baseline
>    sits above the ordinary core migrations: the empty-database
>    bootstrap stamps the highest registered version, which would
>    permanently retire every ordinary migration under it. The
>    `migrations` check rejects a duplicate version.)
> 5. For every `component_schema_state_<id>` variable that lacks
>    `migrationVersion`, stamp it to `0` so the per-component runner
>    has a defined starting point. (See
>    `scripts/migrate/baseline/sirius-dev-20260518.ts` for an example.)
> 6. Restart the workflow without `SKIP_SCHEMA_DRIFT_CHECK`. Verify
>    "Schema drift check passed" appears in the logs.
> 7. Commit the baseline file. Done.

The baseline for THIS Repl is
`scripts/migrate/baseline/sirius-dev-20260518.ts` — there were no DDL
fix-ups to apply (the dev DB was already in sync via the retired
reflective auto-push), so the baseline is a pure
`migrationVersion`-stamping script.

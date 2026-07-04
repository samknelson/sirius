---
name: Core migrations vs optional components
description: Why core startup migrations must tolerate optional-component tables being absent, and the dispatch/plugin_configs_dispatch FK lifecycle gap.
---

# Core migrations must tolerate absent optional-component tables

Some components are optional (`enabledByDefault: false` in `shared/components.ts`, e.g. `dispatch`). When such a component was never enabled on a deployment, its manifest tables do not exist in that DB (`options_dispatch_job_type`, `dispatch_jobs`, `worker_dispatch_elig_denorm`, etc.).

**Rule:** A *core* startup migration must never hard-depend on an optional-component table. The migration runner stops on the first failure, and the startup schema-drift gate then refuses to boot — so one unguarded core migration bricks the whole app on any deployment where that component is off.

**Why:** Learned when a large merge introduced core migrations 1015 (inline FK to `options_dispatch_job_type`), 1020 (backfill FROM it), and 1041 (TRUNCATE/ALTER `worker_dispatch_elig_denorm`) that crashed boot on a dev DB where dispatch was never enabled.

**How to apply:**
- Guard core migrations that touch optional-component tables with an `information_schema.tables` existence check; skip with a log if absent. Keep the enabled path byte-identical (e.g. 1015 keeps its original inline-FK CREATE when the target table exists, and only drops the FK when it's missing).
- This mirrors the baseline scripts' own `isSafelySkippableError` philosophy (`/relation "..." does not exist/` on an FK add is a normal, skippable condition for a disabled component).

## Lifecycle gap: plugin_configs_dispatch.job_type FK

`plugin_configs_dispatch` is a **core** table but its `job_type` column references `options_dispatch_job_type`, a **dispatch-component** table. On a DB where dispatch was never enabled, migration 1015 creates `plugin_configs_dispatch` WITHOUT that FK.

If dispatch is later enabled on such a DB, `options_dispatch_job_type` gets created but the `plugin_configs_dispatch.job_type` FK is still missing (component schema-push only manages the dispatch manifest tables, not core tables). The startup drift gate will then refuse to boot, reporting the missing FK.

**This is not silent corruption** — it is a clear, gated failure with a known fix: author a new `scripts/migrate/baseline/sirius-dev-<YYYYMMDD>.ts` (modeled on the latest baseline) which re-runs `generateDriftFixStatements` and installs the FK idempotently. A one-time migration can't fix this because it runs once (before dispatch is ever enabled); the proper long-term fix would live in the dispatch enable flow.

## Bringing a behind dev DB into sync after a big pull

Pattern used: (1) restart so the startup migration runner applies pending numbered migrations; (2) fix any core migration that fails on an absent optional-component table (guard it); (3) for residual named/unnamed constraint drift the gate reports, author a fresh dated baseline at a version ABOVE the latest numbered migration (must be `> migrations_version` to run) modeled on the previous baseline.

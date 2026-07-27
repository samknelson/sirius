---
name: Non-singleton cron plugins
description: How multi-config cron plugins work — scheduler keys by config id, deriveSchedule overrides the stored schedule column.
---

Cron plugins may set `singleton: false`: admins create any number of config
rows via the generic plugin admin page; the scheduler runs each enabled config
as its own task, keyed by the config row's id (not the plugin id).

**Why:** the scheduled benefit-scan sweep needs multiple independent
schedules/populations of one plugin.

**How to apply / gotchas:**
- A plugin with a `deriveSchedule(settings)` hook has its EFFECTIVE cron
  expression + IANA timezone derived from friendly `data` fields; the stored
  `plugin_configs_cron.schedule` column is ignored for scheduling (still
  required at create by the kind adapter). node-cron gets `{ timezone }`.
- Non-singleton plugins are NOT boot-seeded (seeder skips `!singleton`), and
  storage create/delete guards auto-allow them via the manifest flag.
- `cron_job_runs` history stays keyed by plugin id → all configs of one
  plugin share a history stream; `manualRun(jobName)` executes EVERY config.
- Cross-field save-time validation goes in the optional
  `validateSettings(data)` hook (runs after the JSON-schema check).
- Standalone tsx verification scripts must `import "server/storage/database"`
  FIRST or PluginRegistry circular-init crashes (see eligibility smoke tests).

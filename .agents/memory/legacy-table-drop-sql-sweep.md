---
name: Dropping a legacy table requires a full executable-SQL sweep
description: When migrating a plugin "kind" off its bespoke table onto unified plugin_configs, dropping the old table breaks raw queries that live OUTSIDE the storage layer.
---

When you cut a config "kind" over from a bespoke table (e.g. `charge_plugin_configs`)
to the unified `plugin_configs` + `plugin_configs_<kind>` tables and then DROP the old
table, the storage module is NOT the only place that touched it.

**Rule:** Before dropping a legacy table, grep the whole repo for the literal table
name in executable SQL (`rg '<table_name>'`), not just the storage module. Service
files sometimes hold raw `getClient().execute(sql\`...\`)` queries that bypass the
storage-layer rule and will throw `relation "<table>" does not exist` at runtime the
moment the drop migration runs. These often live in cron-triggered or wizard-triggered
paths that don't surface at boot, so a clean drift-gate boot is NOT proof they're gone.

**Why:** During the charge migration, `getDuesAccountId()` in
`server/services/member-status-scan.ts` still did `SELECT settings FROM
charge_plugin_configs ...`. It boots fine (lazy call path via BTU dues allocation) but
breaks at scan time. The storage rewrite + drift gate both passed; only a repo-wide
text sweep caught it.

**How to apply:** For the downstream dispatch/eligibility kind migrations, after
rewriting storage, run `rg '<old_table_name>'` excluding `scripts/migrate/**` and
comments, and repoint every executable hit through `storage.*` before registering the
drop migration. Comments/migration files are fine to leave.

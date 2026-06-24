---
name: denorm backfill is enqueue-then-recompute
description: backfillAllDenorm only enqueues stale rows; recompute is deferred to the denorm_stale cron — any admin "rebuild now" UX is async-eventual, not synchronous.
---

`backfillAllDenorm({ pluginId })` does NOT compute/write denorm payloads. It only
(1) enqueues entity ids missing a denorm row as `stale` and (2) deletes widow
rows. The actual `compute`+`write` happens later in the `denorm_stale` recompute
cron job. So a denorm row appears in two steps, not one.

**Why:** large backlogs drain over several hourly runs (per-plugin `limit` cap),
so the framework deliberately separates enqueue from recompute. A caller that
expects synchronous "rows are now correct" after backfill is wrong.

**How to apply:** when porting a plugin's old *synchronous* backfill (which
processed workers and wrote rows in one call) into the denorm framework, any
admin "Run Backfill / rebuild now" route/UX must be reworded to "enqueued for
recompute" — the eligibility/denorm data is not final until the stale recompute
runs. Report `summary.perPlugin[].enqueued/deleted`, not "entries created".

Related: migrating a plugin's write side leaves broken call sites in the
route/admin layer (e.g. a route calling the now-removed `plugin.backfill`); the
startup drift gate and plugin-file edits will NOT catch these — grep the route
layer for the removed write API. Denorm and its read-side counterpart plugins
intentionally share the same plugin id, so an admin route can validate the
read-side plugin then delegate by id via `getDenormPlugin(id)`.

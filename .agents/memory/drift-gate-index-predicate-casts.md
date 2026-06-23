---
name: Drift gate index predicate cast matching
description: Why partial-index WHERE predicates on text/varchar columns must be written casted in shared/schema.ts to pass the startup drift gate.
---

The startup schema drift gate reflects index predicates and compares them, but
`normalizeIndexExpr` (in `server/services/component-schema-push.ts`, also used by
`server/services/schema-drift-check.ts`) only lowercases, strips
schema/table qualification, strips balanced outer parens, and collapses
whitespace. It does **NOT** strip `::text` (or other) casts.

**Consequence:** Postgres reflects a partial-index predicate on a `varchar`/`text`
column compared to a literal as `(col)::text = 'val'::text`. If you declare the
Drizzle index `.where(sql\`${table.col} = 'val'\`)`, the gate's "expected" stays
`col = 'val'` and "found" is `(col)::text = 'val'::text` → drift, boot refused.

**How to apply:** Write the schema predicate to match Postgres's reflected,
normalized form exactly — for a varchar/text equality use
`.where(sql\`(${table.col})::text = 'val'::text\`)`. Boolean predicates
(`is_active = true`) need no cast and match as-is. The migration SQL can stay
natural (`WHERE col = 'val'`); only the Drizzle schema declaration must mirror
the casted form. Verify by booting — the gate error prints expected vs found.

**Why:** This bit the cron-singleton partial unique index
(`plugin_configs_singleton_cron_uniq` on `(plugin_kind, plugin_id) WHERE
plugin_kind = 'cron'`); first boot failed with
`expected plugin_kind = 'cron', found (plugin_kind)::text = 'cron'::text`.

---
name: Cross-table uniqueness in unified plugin_configs
description: How to restore a DB-level uniqueness tuple that spans the unified plugin_configs base + a per-kind subsidiary table.
---

When a plugin "kind" migrates off its bespoke table onto unified `plugin_configs`
(base) + `plugin_configs_<kind>` (subsidiary), a uniqueness tuple from the old table
often spans BOTH tables. Charge's legacy 4-tuple was
`(plugin_id, scope, employer_id, account)`: `plugin_id` lives on the base,
`scope/employer_id/account` on the subsidiary. Postgres UNIQUE indexes are
single-table, so the split silently drops the old DB guarantee.

**Rule:** To restore DB-level enforcement, denormalize the base discriminator
(`plugin_id`) onto the subsidiary table, keep it in sync on every write (adapter
`toRows` subsidiary + the subsidiary `upsert` onConflict `set`), and build the
unique index on the subsidiary. Make it NULL-safe with COALESCE on the nullable
dimensions (`UNIQUE (plugin_id, scope, COALESCE(employer_id,''), COALESCE(account,''))`)
— a plain UNIQUE treats NULLs as distinct, so two "global" rows (null employer/account)
for the same plugin would NOT collide.

**Why:** A plain split loses defense-in-depth: route-level collision checks
(select-then-insert) are racy and a duplicate billing config can double-charge. The
original bespoke table had a real DB unique constraint; parity means restoring it.

**How to apply:** Keep the route-level 409 (`rejectIfDuplicate`/`uniqueKey` hook) for
friendly UX AND add the DB index for integrity. The drift gate flags extra COLUMNS but
not extra indexes, so the denormalized column must be declared in the Drizzle schema
(lockstep with the migration), while a COALESCE expression index can live in the
migration only (Drizzle can't reflect it cleanly) without tripping drift.

---
name: Synthetic S1 regen invalidates id_map
description: Regenerating the synthetic S1 MariaDB assigns NEW nids; existing s1_staging.id_map rows go stale
---

Regenerating the synthetic S1 database truncates and re-inserts nodes; MariaDB
assigns fresh auto-increment nids even with the same seed, so every existing
`s1_staging.id_map` row (keyed by old nids) goes stale and id_map-resolving
loaders silently resolve nothing.

**Why:** loaders join staged rows to S2 entities only through id_map; stale
keys look like "no resolvable worker", not like an error.

**How to apply:** after any regen: restage, then re-run `load-contacts-workers`
(writes id_map rows for the new nids) before any loader that resolves
workers/contacts. Old rows for dead nids are harmless — EXCEPT for converted
sync loaders with hard-delete sweep policies, whose first post-regen run
deletes the S2 rows behind retired-nid mappings and recreates staged rows
under new nids. That churn is convergence (S1 wins), not data loss; run the
loaders in RUNBOOK order so cross-loader cascades heal the same run.

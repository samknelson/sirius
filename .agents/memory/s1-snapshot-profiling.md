---
name: S1 source of truth (MariaDB, not the Neon sample)
description: The old read-only Neon "S1" DB was a retired 10-row sample; real S1 is MariaDB 10.6 — use the structure profile in docs/s1-migration.
---

The read-only Neon Postgres "S1" database was a **transloaded ~10-rows-per-table sample (431 of 818 tables) and is retired** — never profile or build against it again.

**Why:** the real S1 source is Drupal 7 on **MariaDB 10.6.25** (AWS RDS prod). The sample's Postgres types, uniform `node.changed`, masked values and missing tables produced wrong inferences that had to be systematically re-flagged in the migration spec.

**How to apply:**
- Source of truth for S1 shape: `docs/s1-migration/s1-schema.sql` (818-table DDL) + `docs/s1-migration/profile/{tables,columns,fielddata_stats}.tsv` (production structure/aggregates, zero rows). Regenerate the field inventory with `scripts/oneoffs/s1-inventory-from-profile.mjs`.
- All S1-side SQL is MySQL dialect; `deleted` is tinyint (compare unquoted); `entity_type='node'` filter is load-bearing; `field_grievance_shop` = employer ref on many bundles (name ≠ domain).
- Production data is PHI: dev work targets the synthetic-data MariaDB instance; only aggregates/counts ever leave the HIPAA boundary.
- **Synthetic dev DB (as of Aug 2026):** MariaDB on Railway, reachable via the workspace secret `S1_DATABASE_URL` (mysql2 driver). Full 818-table schema + synthetic rows. Railway's public proxy uses a random high port — a URL without an explicit port defaults to 3306 and times out; the port must be in the URL.
- **Synthetic DB seeds field DATA but not field METADATA** — `field_config`/`field_config_instance` are empty, so any Drupal-metadata-driven query silently returns nothing there. The ETL (`scripts/s1-migration/`) auto-falls back to an information_schema table scan; production has real metadata.
- Extract/staging framework lives in `scripts/s1-migration/` (committable); staged records go to the `s1_staging` Postgres schema in the S2 dev DB, deliberately outside shared/schema.ts and the drift gate.
- Prod S1 access is user-side only (drush, aggregates); `S1_DATABASE_URL` in the HIPAA deployment is a different, production value.
- Any "(inferred)" mapping that came from sample *values* is suspect — the re-derivation list lives at the top of `docs/s1-migration/02-mapping.md`.

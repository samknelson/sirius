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

**v5 (2026-08-04):** 06-strategy-revision v5 supersedes all prior versions (production profiling pass). Key: smf_worker_month + sirius_trust_worker_benefit are EXTRACT-AND-STAGE only (tags = computed eligibility state, validation evidence for N17 diff); staging extracts for actively-rewritten tables must run AT FREEZE (§4.17); node.changed is a real timestamp; member-status delta drops (industry disambiguates); carrier migration needs fund-authored alias table (N19) — never sirius_id carry-over; `variable` table holds live credentials, never bulk-migrates, all rotate at cutover; ledger parity measured at freeze snapshot per-participant, never a pinned dollar figure, ETL never silently normalizes. Milestone 1 = sirius_payperiod → worker_hours; only OPEN-2/3/5 (Sam/Kristin) touch it — build to boundaries, surface in run report.

**Loader phase (milestone 1, T20):** `scripts/s1-migration/load-hours.ts` loads staged sirius_payperiod → worker_hours via storage upsert (notifications suppressed); `s1_staging.id_map` is the shared S1→S2 crosswalk (stub rows enriched later by real entity loaders; on races the existing mapping wins). Gotchas: upsertWorkerHours still executes charge plugins per row — production needs an ambient migration flag disabling them (T18 migrates ledger; replay = double-bill); loaders are one-shot-at-freeze, not continuous sync (no stale-group deletion); production field_sirius_json stages as {value, json_denorm_external_id} (two payload columns), loader tolerates scalar too; mysql2 pool uses dateStrings:true so D7 wall-time datetimes stage verbatim.
